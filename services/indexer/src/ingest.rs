use anyhow::Result;
use chrono::Utc;
use diesel::prelude::*;
use serde_json::{json, Value};

use crate::borsh_decode::{decode, Cursor};
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

/// Anchor `emit_cpi!` payload = 8-byte event discriminator + Borsh body.
/// Looks up the event by discriminator then decodes the body against the IDL
/// type tree. Decode failures fall back to a hex dump so one malformed payload
/// can't stall the stream.
pub fn decode_event(registry: &Registry, program_id: &str, data: &[u8]) -> Option<(String, Value)> {
    let def = registry.lookup(program_id, data)?;
    let payload = &data[8..];
    let mut cur = Cursor::new(payload);

    let body = match decode(&def.schema, &def.type_registry, &mut cur) {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(
                program_id,
                event = %def.event_name,
                err = %e,
                "borsh decode failed; emitting raw payload"
            );
            json!({
                "_decode_error": e.to_string(),
                "raw_hex": hex::encode(payload),
            })
        }
    };

    Some((def.event_name.clone(), body))
}
