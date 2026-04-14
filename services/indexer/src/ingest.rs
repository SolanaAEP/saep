use anyhow::Result;
use chrono::Utc;
use diesel::prelude::*;
use serde_json::{json, Value};

use crate::db::PgPool;
use crate::idl::Registry;
use crate::schema::{blocks, program_events};

#[derive(Insertable)]
#[diesel(table_name = blocks)]
pub struct NewBlock<'a> {
    pub slot: i64,
    pub hash: &'a str,
    pub parent_slot: Option<i64>,
    pub processed_at: chrono::DateTime<Utc>,
}

#[derive(Insertable)]
#[diesel(table_name = program_events)]
pub struct NewEvent<'a> {
    pub signature: &'a str,
    pub slot: i64,
    pub program_id: &'a str,
    pub event_name: &'a str,
    pub data: Value,
    pub ingested_at: chrono::DateTime<Utc>,
}

pub fn record_block(pool: &PgPool, b: NewBlock) -> Result<()> {
    let mut conn = pool.get()?;
    diesel::insert_into(blocks::table)
        .values(&b)
        .on_conflict(blocks::slot)
        .do_update()
        .set((
            blocks::hash.eq(b.hash),
            blocks::parent_slot.eq(b.parent_slot),
            blocks::processed_at.eq(b.processed_at),
        ))
        .execute(&mut conn)?;
    Ok(())
}

pub fn record_event(pool: &PgPool, e: NewEvent) -> Result<()> {
    let mut conn = pool.get()?;
    diesel::insert_into(program_events::table)
        .values(&e)
        .on_conflict_do_nothing()
        .execute(&mut conn)?;
    Ok(())
}

/// Decode a single inner-instruction payload.
///
/// Anchor emits events via `emit_cpi!` — the instruction data is
/// `[8-byte event discriminator][borsh payload]`, invoked against the
/// `__event_authority` PDA on the owning program. We match the first 8 bytes
/// against the IDL-derived discriminator registry.
///
/// BORSH-FULL-DECODE-STUB: we currently return the remaining payload as a
/// hex-encoded string inside the data JSONB. Walking the IDL field schema to
/// produce a structured JSON object is the follow-up — the registry already
/// carries the schema per event.
pub fn decode_event(registry: &Registry, program_id: &str, data: &[u8]) -> Option<(String, Value)> {
    let def = registry.lookup(program_id, data)?;
    let payload = &data[8..];
    let body = json!({
        "raw_hex": hex::encode(payload),
        "len": payload.len(),
    });
    Some((def.event_name.clone(), body))
}
