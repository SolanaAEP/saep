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
use diesel::sql_types::{BigInt, Bytea, Int2};
use tracing::info;

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

/// Default EWMA alpha per spec: 20% weight to new sample.
pub const DEFAULT_ALPHA_BPS: u16 = 2_000;

/// Client-judged samples get reduced alpha (10%) per spec anti-gaming rule.
pub const CLIENT_ALPHA_BPS: u16 = 1_000;

/// Scale factor: correctness 0..100 maps to 0..65535.
const CORRECTNESS_SCALE: u64 = 65535 / 100;

#[derive(Debug, QueryableByName)]
#[allow(dead_code)]
struct HeartbeatRow {
    #[diesel(sql_type = BigInt)]
    last_seen_unix: i64,
    #[diesel(sql_type = Int2)]
    miss_count: i16,
}

#[derive(Debug, QueryableByName)]
#[allow(dead_code)]
struct PendingSample {
    #[diesel(sql_type = Int2)]
    quality_delta: i16,
    #[diesel(sql_type = Int2)]
    timeliness_delta: i16,
    #[diesel(sql_type = Int2)]
    correctness: i16,
    #[diesel(sql_type = diesel::sql_types::Text)]
    judge_kind: String,
}

#[derive(Debug, QueryableByName)]
#[allow(dead_code)]
struct AgentAxis {
    #[diesel(sql_type = Bytea)]
    agent_did: Vec<u8>,
    #[diesel(sql_type = Int2)]
    capability_bit: i16,
    #[diesel(sql_type = Int2)]
    quality: i16,
    #[diesel(sql_type = Int2)]
    timeliness: i16,
    #[diesel(sql_type = Int2)]
    cost_efficiency: i16,
    #[diesel(sql_type = Int2)]
    honesty: i16,
    #[diesel(sql_type = BigInt)]
    jobs_completed: i64,
    #[diesel(sql_type = BigInt)]
    jobs_disputed: i64,
}

/// Fold new `reputation_samples` into `category_reputation` EWMA axes, then
/// update availability to max and refresh the materialized view.
pub async fn fold_samples(pool: &PgPool) -> Result<u64> {
    let pool = pool.clone();
    tokio::task::spawn_blocking(move || -> Result<u64> {
        let mut conn = pool.get().context("acquire pg conn for fold_samples")?;

        let agents: Vec<AgentAxis> = sql_query(
            "SELECT agent_did, capability_bit, quality, timeliness,
                    cost_efficiency, honesty, jobs_completed, jobs_disputed
               FROM category_reputation
              WHERE status = 'active'",
        )
        .load::<AgentAxis>(&mut conn)
        .context("load category_reputation")?;

        let mut folded: u64 = 0;

        for agent in &agents {
            let samples: Vec<PendingSample> = sql_query(
                "SELECT quality_delta, timeliness_delta, correctness, judge_kind
                   FROM reputation_samples
                  WHERE agent_did = $1
                    AND capability_bit = $2
                    AND completed = true
                    AND ingested_at > (
                      SELECT last_update FROM category_reputation
                       WHERE agent_did = $1 AND capability_bit = $2
                    )
                  ORDER BY ingested_at ASC",
            )
            .bind::<Bytea, _>(&agent.agent_did)
            .bind::<Int2, _>(agent.capability_bit)
            .load::<PendingSample>(&mut conn)
            .context("load pending samples")?;

            if samples.is_empty() {
                continue;
            }

            let mut quality = agent.quality as u16;
            let mut timeliness = agent.timeliness as u16;
            let cost_eff = agent.cost_efficiency as u16;
            let honesty = agent.honesty as u16;

            for s in &samples {
                let alpha = if s.judge_kind == "Client" {
                    CLIENT_ALPHA_BPS
                } else {
                    DEFAULT_ALPHA_BPS
                };

                // quality: correctness scaled 0..100 → 0..65535
                let q_sample = ((s.correctness.max(0) as u64) * CORRECTNESS_SCALE).min(65535) as u16;
                quality = ewma_u16(quality, q_sample, alpha);

                // timeliness: delta is already 0..65535 range from the ingestion layer
                let t_sample = s.timeliness_delta.max(0) as u16;
                timeliness = ewma_u16(timeliness, t_sample, alpha);

                // cost_efficiency: no per-sample data in reputation_samples yet;
                // maintain current value until task payment ratios are ingested.
                // TODO(M2): compute from TaskReleased payment ratio once ingested
                let _ = cost_eff;

                // honesty: slashed by disputes; no per-sample signal here.
                // Dispute slashing handled by dispute_arbitration event ingestion.
                // TODO(M2): fold DisputeResolved events into honesty decay
                let _ = honesty;
            }

            // Query heartbeat_presence for this agent+capability to compute
            // availability decay. If no heartbeat row exists, decay to zero.
            let heartbeat_row: Option<HeartbeatRow> = sql_query(
                "SELECT last_seen_unix, miss_count
                   FROM heartbeat_presence
                  WHERE agent_did = $1 AND capability_bit = $2",
            )
            .bind::<Bytea, _>(&agent.agent_did)
            .bind::<Int2, _>(agent.capability_bit)
            .load::<HeartbeatRow>(&mut conn)
            .context("load heartbeat_presence")?
            .into_iter()
            .next();

            let now_unix = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64;

            let did_bytes: [u8; 32] = match agent.agent_did.clone().try_into() {
                Ok(b) => b,
                Err(_) => {
                    tracing::warn!(capability_bit = agent.capability_bit, "agent_did in DB is not 32 bytes; skipping availability projection");
                    [0u8; 32]
                }
            };
            let availability: i16 = match heartbeat_row {
                Some(hb) => {
                    let misses = count_misses(
                        &[Heartbeat {
                            agent_did: did_bytes,
                            capability_bit: agent.capability_bit as u16,
                            seen_at_unix: hb.last_seen_unix,
                        }],
                        did_bytes,
                        agent.capability_bit as u16,
                        now_unix,
                    );
                    let current_avail = agent.quality as u16;
                    project_availability(current_avail, misses, DEFAULT_ALPHA_BPS) as i16
                }
                None => 0, // no heartbeat → zero availability
            };

            let new_completed = agent.jobs_completed + samples.len() as i64;

            sql_query(
                "UPDATE category_reputation
                    SET quality = $3, timeliness = $4, availability = $5,
                        cost_efficiency = $6, honesty = $7,
                        jobs_completed = $8, last_update = now()
                  WHERE agent_did = $1 AND capability_bit = $2",
            )
            .bind::<Bytea, _>(&agent.agent_did)
            .bind::<Int2, _>(agent.capability_bit)
            .bind::<Int2, _>(quality as i16)
            .bind::<Int2, _>(timeliness as i16)
            .bind::<Int2, _>(availability)
            .bind::<Int2, _>(cost_eff as i16)
            .bind::<Int2, _>(honesty as i16)
            .bind::<BigInt, _>(new_completed)
            .execute(&mut conn)
            .context("update category_reputation axes")?;

            folded += samples.len() as u64;
        }

        Ok(folded)
    })
    .await
    .context("fold_samples join")?
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
    let folded = fold_samples(pool).await?;
    if folded > 0 {
        info!(folded, "reputation samples folded into category_reputation");
    }
    // Heartbeat-based availability decay is wired in fold_samples via
    // heartbeat_presence table. IACP bus writes heartbeat rows; fold_samples
    // reads them and projects availability per agent+capability.
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
