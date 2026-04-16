//! Retro airdrop nightly rollup (spec: `specs/retro-airdrop.md`).
//!
//! Pipeline (per snapshot_epoch):
//!   1. Fetch FeeClaim events from `program_events` within trailing 6 epochs.
//!   2. Classify each via wash filters (self-task, circular, burst, below-min).
//!   3. Aggregate to operator level — sum net_fees and wash_excluded.
//!   4. Apply personhood tier + cold-start multipliers.
//!   5. Compute estimated_allocation (illustrative until TGE; FEE_MULTIPLIER
//!      frozen at M3).
//!   6. Upsert `retro_eligibility`, append raw samples to `retro_fee_samples`.
//!
//! DB reads bypass the absent fee_collector accrual event by joining
//! TaskReleased against TaskCreated + AgentRegistered in `program_events`.
//! Pure classification + aggregation functions are exercised by unit tests.

use std::collections::{HashMap, HashSet};

use anyhow::Context;
use diesel::prelude::*;
use diesel::sql_query;
use diesel::sql_types::{BigInt, Bytea, Int4, Text};

/// Tasks under $0.10 USDC-equivalent excluded (spam-farming filter).
pub const MIN_PAYMENT_MICRO_USDC: u64 = 100_000;

/// Burst threshold: >10× 30-day median in the final week before snapshot.
pub const BURST_MULTIPLIER: f64 = 10.0;

/// Circular-settlement graph traversal depth.
pub const CIRCULAR_DEPTH: u32 = 3;

/// If >40% of an operator's fee traces back to self, down-weight to 0.
pub const CIRCULAR_FEE_FRACTION: f64 = 0.40;

/// Cold-start window: agents registered within this many epochs of snapshot
/// receive a 0.5 multiplier. Epoch = 30 days per spec; 2-week protection
/// rounds to half an epoch.
pub const COLD_START_EPOCHS: i32 = 1;

/// Personhood multipliers per `specs/retro-airdrop.md#eligibility`.
pub const MULT_NONE: f64 = 0.50;
pub const MULT_BASIC: f64 = 0.75;
pub const MULT_VERIFIED: f64 = 1.00;

pub const COLD_START_MULT: f64 = 0.50;

/// Trailing epochs to include in each snapshot window.
pub const TRAILING_EPOCHS: i32 = 6;

/// Illustrative fee multiplier until TGE (frozen at M3 per spec).
pub const FEE_MULTIPLIER: f64 = 1.0;

/// Illustrative retro pool size in tokens until TGE.
pub const RETRO_POOL_TOKENS: f64 = 100_000_000.0;

pub type Pubkey = [u8; 32];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PersonhoodTier {
    None,
    Basic,
    Verified,
}

impl PersonhoodTier {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Basic => "basic",
            Self::Verified => "verified",
        }
    }

    pub fn multiplier(&self) -> f64 {
        match self {
            Self::None => MULT_NONE,
            Self::Basic => MULT_BASIC,
            Self::Verified => MULT_VERIFIED,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WashFlag {
    SelfTask,
    Circular,
    Burst,
    BelowMin,
}

impl WashFlag {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::SelfTask => "self_task",
            Self::Circular => "circular",
            Self::Burst => "burst",
            Self::BelowMin => "below_min",
        }
    }
}

#[derive(Debug, Clone)]
pub struct FeeSample {
    pub signature: String,
    pub slot: i64,
    pub operator: Pubkey,
    pub agent_did: Pubkey,
    pub task_id: Pubkey,
    pub client: Pubkey,
    pub epoch: i32,
    pub fee_micro_usdc: u64,
}

#[derive(Debug, Clone)]
pub struct ClassifiedSample {
    pub inner: FeeSample,
    pub wash_flag: Option<WashFlag>,
}

#[derive(Debug, Clone)]
pub struct AgentMeta {
    pub operator: Pubkey,
    pub registered_epoch: i32,
}

/// Adjacency lookup powering wash-trading heuristics. In production this is
/// backed by `agent_registry` and `task_market` materialized views; tests
/// construct it in-memory.
#[derive(Debug, Default)]
pub struct OperatorGraph {
    /// agent_did → operator.
    pub agent_owner: HashMap<Pubkey, Pubkey>,
    /// operator → set of agent_dids they operate.
    pub operator_agents: HashMap<Pubkey, HashSet<Pubkey>>,
}

impl OperatorGraph {
    pub fn insert_agent(&mut self, agent_did: Pubkey, operator: Pubkey) {
        self.agent_owner.insert(agent_did, operator);
        self.operator_agents
            .entry(operator)
            .or_default()
            .insert(agent_did);
    }

    /// Is `candidate` (a pubkey seen as task.client) transitively owned by
    /// `operator` within `depth` hops? Depth 0 = direct equality.
    pub fn owned_by(&self, operator: &Pubkey, candidate: &Pubkey, depth: u32) -> bool {
        if operator == candidate {
            return true;
        }
        if depth == 0 {
            return false;
        }
        if let Some(owner) = self.agent_owner.get(candidate) {
            if owner == operator {
                return true;
            }
            return self.owned_by(operator, owner, depth - 1);
        }
        false
    }
}

#[derive(Debug, Clone)]
pub struct OperatorRollup {
    pub operator: Pubkey,
    pub net_fees_micro_usdc: u64,
    pub wash_excluded_micro_usdc: u64,
    pub personhood_tier: PersonhoodTier,
    pub personhood_multiplier: f64,
    pub cold_start_multiplier: f64,
    pub estimated_allocation: Option<f64>,
    pub epoch_first_seen: i32,
}

/// Inputs the nightly job needs per operator beyond fee samples themselves.
#[derive(Debug, Clone, Default)]
pub struct OperatorContext {
    pub personhood: HashMap<Pubkey, PersonhoodTier>,
    pub agent_registered_epoch: HashMap<Pubkey, i32>,
}

impl OperatorContext {
    pub fn tier(&self, operator: &Pubkey) -> PersonhoodTier {
        self.personhood
            .get(operator)
            .cloned()
            .unwrap_or(PersonhoodTier::None)
    }

    /// Cold-start = any agent under this operator was registered within
    /// `COLD_START_EPOCHS` of the snapshot epoch.
    pub fn cold_start(&self, operator: &Pubkey, snapshot_epoch: i32, graph: &OperatorGraph) -> bool {
        let Some(agents) = graph.operator_agents.get(operator) else {
            return false;
        };
        agents.iter().any(|agent| {
            self.agent_registered_epoch
                .get(agent)
                .is_some_and(|e| snapshot_epoch - *e < COLD_START_EPOCHS)
        })
    }
}

/// Classifies each raw fee sample with the first matching wash flag. Order
/// matters: below_min is cheapest to compute and most specific, burst is
/// distributional and runs last so it doesn't mask a real self-task exclusion.
pub fn classify(
    samples: &[FeeSample],
    graph: &OperatorGraph,
    snapshot_epoch: i32,
) -> Vec<ClassifiedSample> {
    let burst_flags = detect_burst(samples, snapshot_epoch);
    samples
        .iter()
        .enumerate()
        .map(|(idx, sample)| {
            let flag = if sample.fee_micro_usdc < MIN_PAYMENT_MICRO_USDC {
                Some(WashFlag::BelowMin)
            } else if graph.owned_by(&sample.operator, &sample.client, CIRCULAR_DEPTH) {
                if &sample.operator == &sample.client {
                    Some(WashFlag::SelfTask)
                } else {
                    Some(WashFlag::Circular)
                }
            } else if burst_flags.contains(&idx) {
                Some(WashFlag::Burst)
            } else {
                None
            };
            ClassifiedSample {
                inner: sample.clone(),
                wash_flag: flag,
            }
        })
        .collect()
}

/// Returns sample indices classified as burst. Burst = any fee from the final
/// week (= `snapshot_epoch`) whose per-operator contribution exceeds
/// `BURST_MULTIPLIER × pre-burst median per-sample fee`.
pub fn detect_burst(samples: &[FeeSample], snapshot_epoch: i32) -> HashSet<usize> {
    let mut by_operator: HashMap<Pubkey, Vec<(usize, &FeeSample)>> = HashMap::new();
    for (idx, s) in samples.iter().enumerate() {
        by_operator.entry(s.operator).or_default().push((idx, s));
    }

    let mut flagged = HashSet::new();
    for (_, per_op) in by_operator {
        let pre_burst: Vec<u64> = per_op
            .iter()
            .filter(|(_, s)| s.epoch < snapshot_epoch)
            .map(|(_, s)| s.fee_micro_usdc)
            .collect();
        if pre_burst.is_empty() {
            continue;
        }
        let median = median_u64(&pre_burst);
        if median == 0 {
            continue;
        }
        let cutoff = (median as f64) * BURST_MULTIPLIER;
        for (idx, s) in per_op {
            if s.epoch == snapshot_epoch && (s.fee_micro_usdc as f64) > cutoff {
                flagged.insert(idx);
            }
        }
    }
    flagged
}

fn median_u64(vals: &[u64]) -> u64 {
    let mut sorted: Vec<u64> = vals.to_vec();
    sorted.sort_unstable();
    let mid = sorted.len() / 2;
    if sorted.len() % 2 == 0 {
        (sorted[mid - 1] + sorted[mid]) / 2
    } else {
        sorted[mid]
    }
}

/// Aggregates classified samples to per-operator totals. Net fees excludes any
/// sample carrying a wash flag; the excluded micro-usdc is tracked separately
/// so the portal can show what was filtered and why.
pub fn aggregate(
    classified: Vec<ClassifiedSample>,
    ctx: &OperatorContext,
    graph: &OperatorGraph,
    snapshot_epoch: i32,
) -> Vec<OperatorRollup> {
    #[derive(Default)]
    struct Acc {
        net: u64,
        wash: u64,
        first_epoch: Option<i32>,
    }
    let mut by_op: HashMap<Pubkey, Acc> = HashMap::new();
    for c in classified {
        let entry = by_op.entry(c.inner.operator).or_default();
        if c.wash_flag.is_some() {
            entry.wash = entry.wash.saturating_add(c.inner.fee_micro_usdc);
        } else {
            entry.net = entry.net.saturating_add(c.inner.fee_micro_usdc);
        }
        entry.first_epoch = Some(match entry.first_epoch {
            Some(prev) => prev.min(c.inner.epoch),
            None => c.inner.epoch,
        });
    }

    // Circular down-weight: if an operator's wash_excluded exceeds
    // CIRCULAR_FEE_FRACTION of gross fees, zero the net (spec §wash-trading 2).
    let mut out: Vec<OperatorRollup> = Vec::with_capacity(by_op.len());
    for (operator, mut acc) in by_op {
        let gross = acc.net.saturating_add(acc.wash);
        if gross > 0 && (acc.wash as f64) / (gross as f64) > CIRCULAR_FEE_FRACTION {
            acc.wash = acc.wash.saturating_add(acc.net);
            acc.net = 0;
        }

        let tier = ctx.tier(&operator);
        let personhood_multiplier = tier.multiplier();
        let cold_start_multiplier = if ctx.cold_start(&operator, snapshot_epoch, graph) {
            COLD_START_MULT
        } else {
            1.0
        };

        out.push(OperatorRollup {
            operator,
            net_fees_micro_usdc: acc.net,
            wash_excluded_micro_usdc: acc.wash,
            personhood_tier: tier,
            personhood_multiplier,
            cold_start_multiplier,
            estimated_allocation: None,
            epoch_first_seen: acc.first_epoch.unwrap_or(snapshot_epoch),
        });
    }
    out
}

/// Final step: applies FEE_MULTIPLIER and caps per spec §per-agent cap. Pool
/// size + multiplier are illustrative until TGE — portal displays as
/// "estimated, not guaranteed".
pub fn estimate_allocations(
    rollups: &mut [OperatorRollup],
    fee_multiplier: f64,
    retro_pool_tokens: f64,
) {
    let global_cap = retro_pool_tokens * 0.01; // 1% absolute cap per operator
    let per_operator_floor = retro_pool_tokens * 0.005; // 0.5% aggregated ceiling
    for r in rollups {
        let raw = (r.net_fees_micro_usdc as f64)
            * fee_multiplier
            * r.personhood_multiplier
            * r.cold_start_multiplier;
        let capped = raw.min(global_cap).min(per_operator_floor);
        r.estimated_allocation = Some(capped);
    }
}

/// Raw row returned by the fee-sample query. Joins TaskReleased against
/// TaskCreated (for agent_did + client) and AgentRegistered (for operator).
#[derive(Debug, QueryableByName)]
struct RawFeeSample {
    #[diesel(sql_type = Text)]
    signature: String,
    #[diesel(sql_type = BigInt)]
    slot: i64,
    #[diesel(sql_type = Bytea)]
    operator: Vec<u8>,
    #[diesel(sql_type = Bytea)]
    agent_did: Vec<u8>,
    #[diesel(sql_type = Bytea)]
    task_id: Vec<u8>,
    #[diesel(sql_type = Bytea)]
    client: Vec<u8>,
    #[diesel(sql_type = Int4)]
    epoch: i32,
    #[diesel(sql_type = BigInt)]
    fee_micro_usdc: i64,
}

/// Personhood tier row for an operator.
#[derive(Debug, QueryableByName)]
struct RawPersonhood {
    #[diesel(sql_type = Bytea)]
    operator: Vec<u8>,
    #[diesel(sql_type = Int4)]
    tier: i32,
}

/// Registration epoch for an agent.
#[derive(Debug, QueryableByName)]
struct RawRegistration {
    #[diesel(sql_type = Bytea)]
    agent_did: Vec<u8>,
    #[diesel(sql_type = Int4)]
    reg_epoch: i32,
}

fn vec_to_pubkey(v: &[u8]) -> Pubkey {
    let mut pk = [0u8; 32];
    let len = v.len().min(32);
    pk[..len].copy_from_slice(&v[..len]);
    pk
}

/// Nightly orchestrator. `snapshot_epoch` is the epoch whose trailing-6 window
/// the job scores. Joins TaskReleased events against TaskCreated (for
/// agent_did + client attribution) and AgentRegistered (for operator mapping),
/// bypassing the absent fee_collector accrual event.
pub async fn run(pool: &crate::db::PgPool, snapshot_epoch: i32) -> anyhow::Result<RollupReport> {
    let pool = pool.clone();
    let report = tokio::task::spawn_blocking(move || -> anyhow::Result<RollupReport> {
        let mut conn = pool.get().context("acquire pg conn for retro rollup")?;

        let epoch_start = snapshot_epoch - (TRAILING_EPOCHS - 1);

        // 1. Fetch fee samples by joining TaskReleased → TaskCreated → AgentRegistered.
        //    Epoch is derived from slot: 1 epoch ≈ 30 days ≈ 5_184_000 slots at 400ms.
        let raw_samples: Vec<RawFeeSample> = sql_query(
            "SELECT
                rel.signature,
                rel.slot,
                decode(reg.data->>'operator', 'hex') AS operator,
                decode(tc.data->>'agent_did', 'hex') AS agent_did,
                decode(rel.data->>'task_id', 'hex')  AS task_id,
                decode(tc.data->>'client', 'hex')    AS client,
                (rel.slot / 5184000)::int            AS epoch,
                (rel.data->>'agent_payout')::bigint  AS fee_micro_usdc
             FROM program_events rel
             JOIN program_events tc
               ON tc.event_name = 'TaskCreated'
              AND tc.data->>'task_id' = rel.data->>'task_id'
             JOIN program_events reg
               ON reg.event_name = 'AgentRegistered'
              AND reg.data->>'agent_did' = tc.data->>'agent_did'
             WHERE rel.event_name = 'TaskReleased'
               AND (rel.slot / 5184000)::int BETWEEN $1 AND $2
             ORDER BY rel.slot",
        )
        .bind::<Int4, _>(epoch_start)
        .bind::<Int4, _>(snapshot_epoch)
        .load::<RawFeeSample>(&mut conn)
        .context("fetch fee samples")?;

        if raw_samples.is_empty() {
            tracing::info!(snapshot_epoch, "retro-rollup: no fee samples in window");
            return Ok(RollupReport {
                snapshot_epoch,
                operators_scored: 0,
                samples_classified: 0,
                status: RollupStatus::Scored,
            });
        }

        // 2. Build OperatorGraph from AgentRegistered events.
        let registrations: Vec<RawRegistration> = sql_query(
            "SELECT
                decode(data->>'agent_did', 'hex') AS agent_did,
                (slot / 5184000)::int             AS reg_epoch
             FROM program_events
             WHERE event_name = 'AgentRegistered'",
        )
        .load::<RawRegistration>(&mut conn)
        .context("fetch registrations")?;

        let mut graph = OperatorGraph::default();
        let mut ctx = OperatorContext::default();

        for raw in &raw_samples {
            let agent = vec_to_pubkey(&raw.agent_did);
            let op = vec_to_pubkey(&raw.operator);
            graph.insert_agent(agent, op);
        }

        for reg in &registrations {
            let agent = vec_to_pubkey(&reg.agent_did);
            ctx.agent_registered_epoch.insert(agent, reg.reg_epoch);
        }

        // 3. Fetch personhood tiers.
        let personhood_rows: Vec<RawPersonhood> = sql_query(
            "SELECT DISTINCT ON (decode(data->>'operator', 'hex'))
                decode(data->>'operator', 'hex') AS operator,
                (data->>'tier')::int             AS tier
             FROM program_events
             WHERE event_name = 'PersonhoodAttested'
             ORDER BY decode(data->>'operator', 'hex'), slot DESC",
        )
        .load::<RawPersonhood>(&mut conn)
        .context("fetch personhood")?;

        for ph in &personhood_rows {
            let op = vec_to_pubkey(&ph.operator);
            let tier = match ph.tier {
                2 => PersonhoodTier::Verified,
                1 => PersonhoodTier::Basic,
                _ => PersonhoodTier::None,
            };
            ctx.personhood.insert(op, tier);
        }

        // 4. Convert raw rows to FeeSample structs.
        let samples: Vec<FeeSample> = raw_samples
            .iter()
            .map(|r| FeeSample {
                signature: r.signature.clone(),
                slot: r.slot,
                operator: vec_to_pubkey(&r.operator),
                agent_did: vec_to_pubkey(&r.agent_did),
                task_id: vec_to_pubkey(&r.task_id),
                client: vec_to_pubkey(&r.client),
                epoch: r.epoch,
                fee_micro_usdc: r.fee_micro_usdc as u64,
            })
            .collect();

        // 5. classify → aggregate → estimate
        let classified = classify(&samples, &graph, snapshot_epoch);
        let samples_classified = classified.len();

        let wash_count = classified.iter().filter(|c| c.wash_flag.is_some()).count();

        // 6. Append all classified samples to retro_fee_samples.
        for c in &classified {
            let flag_str = c.wash_flag.as_ref().map(|f| f.as_str().to_string());
            sql_query(
                "INSERT INTO retro_fee_samples
                    (signature, slot, operator, agent_did, task_id, client, epoch,
                     fee_micro_usdc, wash_flag)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                 ON CONFLICT (signature, task_id) DO NOTHING",
            )
            .bind::<Text, _>(&c.inner.signature)
            .bind::<BigInt, _>(c.inner.slot)
            .bind::<Bytea, _>(c.inner.operator.as_slice())
            .bind::<Bytea, _>(c.inner.agent_did.as_slice())
            .bind::<Bytea, _>(c.inner.task_id.as_slice())
            .bind::<Bytea, _>(c.inner.client.as_slice())
            .bind::<Int4, _>(c.inner.epoch)
            .bind::<BigInt, _>(c.inner.fee_micro_usdc as i64)
            .bind::<diesel::sql_types::Nullable<Text>, _>(flag_str.as_deref())
            .execute(&mut conn)
            .context("insert retro_fee_sample")?;
        }

        let mut rollups = aggregate(classified, &ctx, &graph, snapshot_epoch);
        estimate_allocations(&mut rollups, FEE_MULTIPLIER, RETRO_POOL_TOKENS);
        let operators_scored = rollups.len();

        // 7. Upsert retro_eligibility. Numeric fields bound as Text with
        //    SQL-side ::numeric casts to avoid a bigdecimal dependency.
        for r in &rollups {
            let ph_mult = format!("{:.3}", r.personhood_multiplier);
            let cs_mult = format!("{:.3}", r.cold_start_multiplier);
            let alloc = r
                .estimated_allocation
                .map(|a| format!("{a:.6}"));

            sql_query(
                "INSERT INTO retro_eligibility
                    (operator, net_fees_micro_usdc, wash_excluded_micro_usdc,
                     personhood_tier, personhood_multiplier, cold_start_multiplier,
                     estimated_allocation, epoch_first_seen, last_updated)
                 VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7::numeric, $8, now())
                 ON CONFLICT (operator) DO UPDATE SET
                     net_fees_micro_usdc      = EXCLUDED.net_fees_micro_usdc,
                     wash_excluded_micro_usdc = EXCLUDED.wash_excluded_micro_usdc,
                     personhood_tier          = EXCLUDED.personhood_tier,
                     personhood_multiplier    = EXCLUDED.personhood_multiplier,
                     cold_start_multiplier    = EXCLUDED.cold_start_multiplier,
                     estimated_allocation     = EXCLUDED.estimated_allocation,
                     epoch_first_seen         = LEAST(retro_eligibility.epoch_first_seen, EXCLUDED.epoch_first_seen),
                     last_updated             = now()",
            )
            .bind::<Bytea, _>(r.operator.as_slice())
            .bind::<BigInt, _>(r.net_fees_micro_usdc as i64)
            .bind::<BigInt, _>(r.wash_excluded_micro_usdc as i64)
            .bind::<Text, _>(r.personhood_tier.as_str())
            .bind::<Text, _>(&ph_mult)
            .bind::<Text, _>(&cs_mult)
            .bind::<diesel::sql_types::Nullable<Text>, _>(alloc.as_deref())
            .bind::<Int4, _>(r.epoch_first_seen)
            .execute(&mut conn)
            .context("upsert retro_eligibility")?;
        }

        tracing::info!(
            snapshot_epoch,
            operators_scored,
            samples_classified,
            wash_flagged = wash_count,
            "retro-rollup: scored"
        );

        Ok(RollupReport {
            snapshot_epoch,
            operators_scored,
            samples_classified,
            status: RollupStatus::Scored,
        })
    })
    .await
    .context("retro rollup join")??;

    Ok(report)
}


#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RollupStatus {
    Scored,
}

#[derive(Debug, Clone)]
pub struct RollupReport {
    pub snapshot_epoch: i32,
    pub operators_scored: usize,
    pub samples_classified: usize,
    pub status: RollupStatus,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pk(b: u8) -> Pubkey {
        [b; 32]
    }

    fn sample(op: u8, agent: u8, client: u8, epoch: i32, fee: u64, sig: &str) -> FeeSample {
        FeeSample {
            signature: sig.into(),
            slot: epoch as i64 * 1000,
            operator: pk(op),
            agent_did: pk(agent),
            task_id: pk(op ^ agent ^ client),
            client: pk(client),
            epoch,
            fee_micro_usdc: fee,
        }
    }

    #[test]
    fn personhood_multipliers_match_spec() {
        assert_eq!(PersonhoodTier::None.multiplier(), 0.50);
        assert_eq!(PersonhoodTier::Basic.multiplier(), 0.75);
        assert_eq!(PersonhoodTier::Verified.multiplier(), 1.00);
    }

    #[test]
    fn below_min_flagged() {
        let s = sample(1, 10, 20, 3, MIN_PAYMENT_MICRO_USDC - 1, "s1");
        let graph = OperatorGraph::default();
        let out = classify(&[s], &graph, 3);
        assert_eq!(out[0].wash_flag, Some(WashFlag::BelowMin));
    }

    #[test]
    fn self_task_flagged_when_client_eq_operator() {
        let op = 1;
        let s = sample(op, 10, op, 3, 1_000_000, "s1");
        let mut graph = OperatorGraph::default();
        graph.insert_agent(pk(10), pk(op));
        let out = classify(&[s], &graph, 3);
        assert_eq!(out[0].wash_flag, Some(WashFlag::SelfTask));
    }

    #[test]
    fn circular_flagged_when_client_is_agent_of_same_operator() {
        let op = 1;
        let s = sample(op, 10, 11, 3, 1_000_000, "s1");
        let mut graph = OperatorGraph::default();
        graph.insert_agent(pk(10), pk(op));
        graph.insert_agent(pk(11), pk(op));
        let out = classify(&[s], &graph, 3);
        assert_eq!(out[0].wash_flag, Some(WashFlag::Circular));
    }

    #[test]
    fn circular_respects_depth_limit() {
        // chain: 11 → 12 → 13 → 14 → op. Depth 3 stops before reaching op via
        // 14 so this sample should NOT flag circular.
        let op = 1;
        let s = sample(op, 10, 11, 3, 1_000_000, "s1");
        let mut graph = OperatorGraph::default();
        graph.insert_agent(pk(11), pk(12));
        graph.insert_agent(pk(12), pk(13));
        graph.insert_agent(pk(13), pk(14));
        graph.insert_agent(pk(14), pk(op));
        let out = classify(&[s], &graph, 3);
        assert_eq!(out[0].wash_flag, None);
    }

    #[test]
    fn burst_flagged_at_final_epoch_spike() {
        let op = 1;
        let samples = vec![
            sample(op, 10, 99, 0, 1_000_000, "s0"),
            sample(op, 10, 99, 1, 1_000_000, "s1"),
            sample(op, 10, 99, 2, 1_000_000, "s2"),
            sample(op, 10, 99, 3, 50_000_000, "s3"), // 50× median
        ];
        let graph = OperatorGraph::default();
        let out = classify(&samples, &graph, 3);
        assert_eq!(out[3].wash_flag, Some(WashFlag::Burst));
        assert_eq!(out[0].wash_flag, None);
    }

    #[test]
    fn aggregate_sums_net_and_wash_separately() {
        let op = 1;
        let samples = vec![
            sample(op, 10, 99, 0, 1_000_000, "s0"),
            sample(op, 10, 99, 1, 1_000_000, "s1"),
            sample(op, 10, op, 2, 500_000, "s2"), // self-task
        ];
        let mut graph = OperatorGraph::default();
        graph.insert_agent(pk(10), pk(op));
        let classified = classify(&samples, &graph, 2);
        let ctx = OperatorContext::default();
        let out = aggregate(classified, &ctx, &graph, 2);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].net_fees_micro_usdc, 2_000_000);
        assert_eq!(out[0].wash_excluded_micro_usdc, 500_000);
        assert_eq!(out[0].personhood_tier, PersonhoodTier::None);
    }

    #[test]
    fn aggregate_zeroes_net_when_wash_fraction_over_40pct() {
        let op = 1;
        // 1_000_000 clean + 1_000_000 self-task = 50% wash → net→0.
        let samples = vec![
            sample(op, 10, 99, 0, 1_000_000, "s0"),
            sample(op, 10, op, 1, 1_000_000, "s1"),
        ];
        let mut graph = OperatorGraph::default();
        graph.insert_agent(pk(10), pk(op));
        let classified = classify(&samples, &graph, 1);
        let ctx = OperatorContext::default();
        let out = aggregate(classified, &ctx, &graph, 1);
        assert_eq!(out[0].net_fees_micro_usdc, 0);
        assert_eq!(out[0].wash_excluded_micro_usdc, 2_000_000);
    }

    #[test]
    fn cold_start_sets_multiplier() {
        let op = 1;
        let mut graph = OperatorGraph::default();
        graph.insert_agent(pk(10), pk(op));
        let mut ctx = OperatorContext::default();
        ctx.agent_registered_epoch.insert(pk(10), 3);
        let samples = vec![sample(op, 10, 99, 3, 1_000_000, "s0")];
        let classified = classify(&samples, &graph, 3);
        let out = aggregate(classified, &ctx, &graph, 3);
        assert_eq!(out[0].cold_start_multiplier, COLD_START_MULT);
    }

    #[test]
    fn established_operator_has_full_cold_start_multiplier() {
        let op = 1;
        let mut graph = OperatorGraph::default();
        graph.insert_agent(pk(10), pk(op));
        let mut ctx = OperatorContext::default();
        ctx.agent_registered_epoch.insert(pk(10), 0);
        let samples = vec![sample(op, 10, 99, 3, 1_000_000, "s0")];
        let classified = classify(&samples, &graph, 3);
        let out = aggregate(classified, &ctx, &graph, 3);
        assert_eq!(out[0].cold_start_multiplier, 1.0);
    }

    #[test]
    fn estimate_caps_respect_pool_bounds() {
        let mut rollups = vec![OperatorRollup {
            operator: pk(1),
            net_fees_micro_usdc: 1_000_000_000_000, // huge
            wash_excluded_micro_usdc: 0,
            personhood_tier: PersonhoodTier::Verified,
            personhood_multiplier: 1.0,
            cold_start_multiplier: 1.0,
            estimated_allocation: None,
            epoch_first_seen: 0,
        }];
        estimate_allocations(&mut rollups, 1.0, 1_000_000.0);
        // Per-operator 0.5% floor caps at 5_000.
        assert_eq!(rollups[0].estimated_allocation, Some(5_000.0));
    }

    #[test]
    fn estimate_scales_with_personhood_multiplier() {
        let mut rollups = vec![OperatorRollup {
            operator: pk(1),
            net_fees_micro_usdc: 1_000,
            wash_excluded_micro_usdc: 0,
            personhood_tier: PersonhoodTier::Basic,
            personhood_multiplier: 0.75,
            cold_start_multiplier: 1.0,
            estimated_allocation: None,
            epoch_first_seen: 0,
        }];
        estimate_allocations(&mut rollups, 1.0, 1_000_000.0);
        assert_eq!(rollups[0].estimated_allocation, Some(750.0));
    }
}
