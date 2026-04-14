use anyhow::Result;
use chrono::Utc;
use diesel::prelude::*;
use serde_json::Value;

use crate::db::PgPool;
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

/// Turn a raw program transaction into a structured event row.
/// EVENT-DECODE-STUB: once Anchor IDLs are emitted to `target/idl/*.json`, load
/// them at startup and dispatch on the 8-byte event discriminator to decode
/// `data` into a strongly-typed JSON payload. Until then we persist the raw
/// base58 tx signature with an empty event body so reorg handling can still
/// prune these rows by slot.
pub fn decode_event(_program_id: &str, _log_data: &[u8]) -> Option<(String, Value)> {
    None
}
