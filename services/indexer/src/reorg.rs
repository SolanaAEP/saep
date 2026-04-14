use anyhow::Result;
use crate::db::PgPool;

pub struct SlotHeader {
    pub slot: i64,
    pub hash: String,
    pub parent_slot: Option<i64>,
}

/// Compare an incoming slot header against what's already stored for the same slot.
/// Returns Some(prev_hash) when a fork is detected at `slot` — caller should then
/// invoke `rollback_from_slot` for the conflicting slot.
pub fn detect_reorg(_pool: &PgPool, _incoming: &SlotHeader) -> Result<Option<String>> {
    // REORG-LOGIC-STUB:
    //   1. SELECT hash FROM blocks WHERE slot = $1
    //   2. if row exists AND hash != incoming.hash => return Some(existing_hash)
    //   3. else walk back through parent_slot chain to find first divergence
    //   4. returning None means either fresh slot or matching hash
    Ok(None)
}

/// Undo all ingested state at or after `slot`. Must be transactional: every
/// `program_events` row tied to the dropped slots is removed, `blocks` rows
/// pruned, and a `reorg_log` entry written.
pub fn rollback_from_slot(_pool: &PgPool, _slot: i64, _old_hash: &str, _new_hash: &str) -> Result<()> {
    // REORG-LOGIC-STUB:
    //   BEGIN;
    //     DELETE FROM program_events WHERE slot >= $slot;
    //     DELETE FROM blocks         WHERE slot >= $slot;
    //     INSERT INTO reorg_log (slot, old_hash, new_hash, detected_at)
    //     VALUES ($slot, $old_hash, $new_hash, now());
    //   COMMIT;
    //   Consider: replay any dependent downstream caches (Redis pubsub notify).
    Ok(())
}
