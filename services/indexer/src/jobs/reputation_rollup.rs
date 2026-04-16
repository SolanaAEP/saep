//! Reputation rollup refresh + availability-decay projection
//! (spec: `specs/reputation-graph.md`).
//!
//! Two responsibilities:
//!   1. Drive `REFRESH MATERIALIZED VIEW CONCURRENTLY reputation_rollup` — the
//!      leaderboard surface backing `apps/portal/app/agents/leaderboard`.
//!   2. Project the next availability-axis value for each (agent_did,
//!      capability_bit) given IACP heartbeat presence. The actual on-chain
//!      mutation happens via `agent_registry::decay_availability` — this module
//!      produces the preview the portal renders so the decay isn't invisible
//!      between crank invocations.
//!
//! EWMA math mirrors `programs/agent_registry/src/state.rs:111` exactly
//! (BPS_DENOM=10_000, saturating cast back to u16). Tested side-by-side.

use std::collections::HashMap;

use anyhow::{Context, Result};
use diesel::prelude::*;
use diesel::sql_query;

use crate::db::PgPool;

pub const BPS_DENOM: u64 = 10_000;

/// 24h without an IACP inbox publish = heartbeat miss.
pub const HEARTBEAT_MISS_SECS: i64 = 24 * 60 * 60;

/// Miss-count window the crank folds into availability per run.
pub const DECAY_WINDOW_SECS: i64 = 7 * 24 * 60 * 60;

pub type Pubkey = [u8; 32];

/// Matches on-chain `ewma()` byte-for-byte. `alpha_bps` clamped via debug
/// assertion — caller already validated on-chain when producing the sample.
pub fn ewma_u16(old: u16, sample: u16, alpha_bps: u16) -> u16 {
    let alpha = alpha_bps as u64;
    debug_assert!(alpha <= BPS_DENOM);
    let inv = BPS_DENOM - alpha;
    let num = alpha * (sample as u64) + inv * (old as u64);
    (num / BPS_DENOM) as u16
}

/// Composite per `specs/reputation-graph.md#indexer-rollup`: straight mean
/// across the five axes. The on-chain view is authoritative; this is only used
/// for off-chain leaderboard ranking.
pub fn composite_score(
    quality: u16,
    timeliness: u16,
    availability: u16,
    cost_efficiency: u16,
    honesty: u16,
) -> u16 {
    let sum: u64 = quality as u64
        + timeliness as u64
        + availability as u64
        + cost_efficiency as u64
        + honesty as u64;
    (sum / 5) as u16
}

#[derive(Debug, Clone)]
pub struct Heartbeat {
    pub agent_did: Pubkey,
    pub capability_bit: u16,
    pub seen_at_unix: i64,
}

/// Count full 24h windows elapsed since last heartbeat, clipped to the
/// permissionless-crank DECAY_WINDOW_SECS so a long-offline agent doesn't
/// detonate their score on a single crank.
pub fn count_misses(
    events: &[Heartbeat],
    agent_did: Pubkey,
    capability_bit: u16,
    snapshot_unix: i64,
) -> u32 {
    let mut last_seen: Option<i64> = None;
    for e in events {
        if e.agent_did == agent_did && e.capability_bit == capability_bit {
            last_seen = Some(last_seen.map_or(e.seen_at_unix, |prev| prev.max(e.seen_at_unix)));
        }
    }
    let Some(seen) = last_seen else {
        // No presence at all in window → full decay window of misses.
        return (DECAY_WINDOW_SECS / HEARTBEAT_MISS_SECS) as u32;
    };
    let elapsed = (snapshot_unix - seen).max(0);
    let clipped = elapsed.min(DECAY_WINDOW_SECS);
    (clipped / HEARTBEAT_MISS_SECS) as u32
}

/// Project the post-decay availability axis. Each miss folds a zero-sample
/// through the EWMA — so availability compounds down exponentially, not
/// linearly.
pub fn project_availability(prior: u16, miss_count: u32, alpha_bps: u16) -> u16 {
    let mut value = prior;
    for _ in 0..miss_count {
        value = ewma_u16(value, 0, alpha_bps);
    }
    value
}

#[derive(Debug, Clone, Default)]
pub struct ProjectionBatch {
    pub per_agent_bit: HashMap<(Pubkey, u16), u16>,
}

pub fn project_batch(
    priors: &HashMap<(Pubkey, u16), u16>,
    events: &[Heartbeat],
    snapshot_unix: i64,
    alpha_bps: u16,
) -> ProjectionBatch {
    let mut out = ProjectionBatch::default();
    for (&(did, bit), &prior) in priors.iter() {
        let misses = count_misses(events, did, bit, snapshot_unix);
        let projected = project_availability(prior, misses, alpha_bps);
        out.per_agent_bit.insert((did, bit), projected);
    }
    out
}

/// Drives the materialized-view refresh. Called from the rollup worker loop.
/// CONCURRENTLY requires the unique index added in migration
/// `2026-04-16-000003_reputation_rollup/up.sql:ix_reputation_rollup_pk`.
pub async fn refresh_rollup(pool: &PgPool) -> Result<RefreshReport> {
    let pool = pool.clone();
    let report = tokio::task::spawn_blocking(move || -> Result<RefreshReport> {
        let mut conn = pool.get().context("acquire pg conn for rollup refresh")?;
        sql_query("REFRESH MATERIALIZED VIEW CONCURRENTLY reputation_rollup")
            .execute(&mut conn)
            .context("REFRESH MATERIALIZED VIEW CONCURRENTLY reputation_rollup")?;
        Ok(RefreshReport { refreshed: true })
    })
    .await
    .context("rollup refresh join")??;
    Ok(report)
}

#[derive(Debug, Clone)]
pub struct RefreshReport {
    pub refreshed: bool,
}

/// Orchestrator entrypoint. The scheduler calls this every 60s per spec.
pub async fn run(pool: &PgPool) -> Result<RefreshReport> {
    // TODO(reputation-graph): stream heartbeat events from IACP → diesel insert
    //   into heartbeat_presence. Once wired, this call chain will also invoke
    //   project_batch + write preview rows the portal reads.
    refresh_rollup(pool).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn did(b: u8) -> Pubkey {
        [b; 32]
    }

    #[test]
    fn ewma_matches_onchain_behavior() {
        // Same alpha_bps=2000 (20%) defaults as spec.
        assert_eq!(ewma_u16(10_000, 0, 2_000), 8_000);
        assert_eq!(ewma_u16(0, 10_000, 2_000), 2_000);
        // Idempotent when sample == old.
        assert_eq!(ewma_u16(5_000, 5_000, 2_000), 5_000);
    }

    #[test]
    fn composite_is_arithmetic_mean() {
        assert_eq!(composite_score(100, 100, 100, 100, 100), 100);
        assert_eq!(composite_score(0, 0, 0, 0, 0), 0);
        assert_eq!(composite_score(65535, 0, 0, 0, 0), 65535 / 5);
    }

    #[test]
    fn no_events_yields_full_window_misses() {
        let misses = count_misses(&[], did(1), 0, 1_000_000);
        assert_eq!(misses, (DECAY_WINDOW_SECS / HEARTBEAT_MISS_SECS) as u32);
    }

    #[test]
    fn recent_heartbeat_zeroes_misses() {
        let now = 1_000_000;
        let events = vec![Heartbeat {
            agent_did: did(1),
            capability_bit: 0,
            seen_at_unix: now - 60, // 1 minute ago
        }];
        assert_eq!(count_misses(&events, did(1), 0, now), 0);
    }

    #[test]
    fn misses_clip_to_decay_window() {
        let now = 10_000_000;
        let long_ago = now - (DECAY_WINDOW_SECS * 10);
        let events = vec![Heartbeat {
            agent_did: did(1),
            capability_bit: 0,
            seen_at_unix: long_ago,
        }];
        assert_eq!(
            count_misses(&events, did(1), 0, now),
            (DECAY_WINDOW_SECS / HEARTBEAT_MISS_SECS) as u32,
        );
    }

    #[test]
    fn misses_round_down_to_full_24h_windows() {
        let now = 10_000_000;
        // 1.5 days ago → 1 full miss window.
        let events = vec![Heartbeat {
            agent_did: did(1),
            capability_bit: 0,
            seen_at_unix: now - (HEARTBEAT_MISS_SECS + HEARTBEAT_MISS_SECS / 2),
        }];
        assert_eq!(count_misses(&events, did(1), 0, now), 1);
    }

    #[test]
    fn project_availability_decays_exponentially() {
        // alpha 2000bps, start at 10_000, 3 misses.
        // After 1: 8_000. After 2: 6_400. After 3: 5_120.
        assert_eq!(project_availability(10_000, 3, 2_000), 5_120);
    }

    #[test]
    fn project_availability_is_noop_when_no_misses() {
        assert_eq!(project_availability(12_345, 0, 2_000), 12_345);
    }

    #[test]
    fn project_batch_uses_each_agent_bit_events() {
        let mut priors = HashMap::new();
        priors.insert((did(1), 0u16), 10_000u16);
        priors.insert((did(2), 0u16), 10_000u16);
        let now = 1_000_000;
        let events = vec![Heartbeat {
            agent_did: did(1),
            capability_bit: 0,
            seen_at_unix: now - 60,
        }];
        let batch = project_batch(&priors, &events, now, 2_000);
        // did(1) active → no decay; did(2) absent → full window of misses.
        assert_eq!(batch.per_agent_bit[&(did(1), 0)], 10_000);
        assert!(batch.per_agent_bit[&(did(2), 0)] < 10_000);
    }
}
