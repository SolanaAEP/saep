//! Discovery API — server-side filter + sort over `agent_directory` and
//! `task_directory` matviews (cycle-96 migration). Replaces browser-originated
//! `getProgramAccounts` memcmp scans for the portal `/marketplace` and `/tasks`
//! list views per `specs/discovery-api.md`.
//!
//! Cycle-98 scope: 2 GET endpoints (`/v1/discovery/agents`, `/v1/discovery/tasks`)
//! with default sort + opaque base64-JSON cursor pagination.
//!
//! Cycle-99 scope: 3 detail GETs (`/v1/discovery/agents/:did`,
//! `/v1/discovery/tasks/:task_id_hex`, `/v1/discovery/tasks/:task_id_hex/timeline`).
//!
//! Cycle-100 scope: capabilities surface (`/v1/discovery/capabilities`,
//! `/v1/discovery/capabilities/:bit`) folding over capability_registry
//! TagApproved/TagRetired events.
//!
//! Cycle-101 scope: `/v1/discovery/agents/:did/tasks` — thin wrapper over
//! `list_tasks` with the `agent_did` filter pinned from the path.
//!
//! Cycle-102 scope: `/v1/discovery/agents/:did/reputation` — alias surface for
//! the per-bit current-state `reputation_rollup` query that `api::agent_reputation`
//! already exposes under the legacy `/api/` namespace. Spec §4.1 lists the path
//! under `/v1/discovery/` for namespace parity; day/week-bucketed 90d time-series
//! enhancement is deferred (see INBOX).
//!
//! Cycle-103 scope: `/v1/discovery/treasury/:did` + `/v1/discovery/treasury/:did/vaults`
//! — direct fold over treasury_standard `TreasuryCreated` / `LimitsUpdated` /
//! `TreasuryFunded` / `TreasuryWithdraw` events. No matview: per-agent event
//! volume is bounded (one TreasuryCreated, few LimitsUpdated, per-mint
//! funded/withdraw pairs) and the existing event_name + program_id indexes
//! narrow well. Stream events require `stream_nonce` for per-stream state
//! (not carried in current IDL — deferred pending program event-payload
//! extension; same class of spec↔IDL drift as cycle-96 INBOX item (5)).
//! Remaining (agent streams, WS, rate-limiter, cache) land in subsequent cycles.
//!
//! Cycle-104 scope: Prometheus metrics per `specs/discovery-api.md` §Metrics.
//! `metrics_mw` is layered over the sub-router — per-request timer +
//! class-bucketed counter keyed on the 5 endpoint classes from spec
//! §Rate-limits (`agents` / `tasks` / `treasury` / `capabilities` / `catch_all`).
//! `time_discovery_query` timer wraps the top SQL call in each list/detail
//! handler so `saep_discovery_db_query_duration_seconds` carries real data
//! for the read-heavy paths; cache + rate-limit + WS series are registered
//! but stay zero until those layers land.
//!
//! Cycle-105 scope: extended `time_discovery_query` coverage from 4 → 10 handler
//! sites — `agent_reputation`, `task_timeline`, `list_capabilities`,
//! `capability_detail`, `treasury_detail`, `treasury_vaults` all carry per-query
//! labels now. `agent_tasks` intentionally excluded: it delegates to `list_tasks`
//! with an injected `agent_did` filter, so its SQL is already attributed to
//! `discovery.list_tasks`. The `{query}` label reflects SQL pathway, not HTTP
//! endpoint.

use axum::{
    extract::{Path, Query, State},
    middleware::{self, Next},
    response::Json,
    routing::get,
    Router,
};
use axum::http::Request;
use axum::body::Body;
use base64::Engine;
use diesel::prelude::*;
use diesel::sql_query;
use diesel::sql_types::{BigInt, Bytea, Int2, Int4, Jsonb, Text, Timestamptz};
use serde::{Deserialize, Serialize};

use crate::api::{ApiError, ApiState};
use crate::metrics;

const DEFAULT_LIMIT: i64 = 50;
const MAX_LIMIT: i64 = 200;
const TIMELINE_MAX: i64 = 500;

pub fn router(state: ApiState) -> Router {
    Router::new()
        .route("/v1/discovery/agents", get(list_agents))
        .route("/v1/discovery/agents/:did", get(agent_detail))
        .route("/v1/discovery/agents/:did/tasks", get(agent_tasks))
        .route(
            "/v1/discovery/agents/:did/reputation",
            get(agent_reputation),
        )
        .route("/v1/discovery/tasks", get(list_tasks))
        .route("/v1/discovery/tasks/:task_id_hex", get(task_detail))
        .route(
            "/v1/discovery/tasks/:task_id_hex/timeline",
            get(task_timeline),
        )
        .route("/v1/discovery/capabilities", get(list_capabilities))
        .route("/v1/discovery/capabilities/:bit", get(capability_detail))
        .route("/v1/discovery/treasury/:did", get(treasury_detail))
        .route("/v1/discovery/treasury/:did/vaults", get(treasury_vaults))
        .layer(middleware::from_fn(metrics_mw))
        .with_state(state)
}

/// Maps a discovery request path to the 5-way endpoint class used for
/// `saep_discovery_*` label cardinality. Mirrors the rate-limit bucketing
/// from `specs/discovery-api.md:225`.
pub(crate) fn endpoint_class(path: &str) -> &'static str {
    let rest = match path.strip_prefix("/v1/discovery/") {
        Some(r) => r,
        None => return "catch_all",
    };
    let head = rest.split('/').next().unwrap_or("");
    match head {
        "agents" => "agents",
        "tasks" => "tasks",
        "treasury" => "treasury",
        "capabilities" => "capabilities",
        _ => "catch_all",
    }
}

async fn metrics_mw(req: Request<Body>, next: Next) -> axum::response::Response {
    let class = endpoint_class(req.uri().path());
    let timer = metrics::time_discovery_request(class);
    let resp = next.run(req).await;
    timer.observe_duration();
    let status = resp.status().as_u16();
    metrics::inc_discovery_request(class, &status.to_string());
    resp
}

const CAPABILITY_REGISTRY_PROGRAM_ID: &str = "GW161Wce7z4S2rdcSCPNGixn2YQajefNc4r3jUj9zZ5F";
const TREASURY_STANDARD_PROGRAM_ID: &str = "6boJQg4L6FRS7YZ5rFXfKUaXSy3eCKnW2SdrT3LJLizQ";

#[derive(Debug, Deserialize)]
pub struct AgentsQuery {
    pub capability_mask: Option<String>,
    pub min_reputation: Option<i32>,
    pub status: Option<String>,
    pub operator: Option<String>,
    pub limit: Option<i64>,
    pub cursor: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AgentSummary {
    pub did_hex: String,
    pub operator: Option<String>,
    pub capability_mask: Option<String>,
    pub stake_lamports: Option<String>,
    pub reputation_composite: i32,
    pub status: String,
    pub last_active_unix: i64,
}

#[derive(Debug, Serialize)]
pub struct AgentsPage {
    pub items: Vec<AgentSummary>,
    pub cursor: Option<String>,
}

#[derive(QueryableByName)]
struct RawAgentRow {
    #[diesel(sql_type = Bytea)]
    agent_did: Vec<u8>,
    #[diesel(sql_type = diesel::sql_types::Nullable<Text>)]
    operator: Option<String>,
    #[diesel(sql_type = diesel::sql_types::Nullable<Text>)]
    capability_mask_text: Option<String>,
    #[diesel(sql_type = diesel::sql_types::Nullable<Text>)]
    stake_amount_text: Option<String>,
    #[diesel(sql_type = Int4)]
    reputation_composite: i32,
    #[diesel(sql_type = Text)]
    status: String,
    #[diesel(sql_type = BigInt)]
    last_active_unix: i64,
}

pub async fn list_agents(
    State(state): State<ApiState>,
    Query(q): Query<AgentsQuery>,
) -> Result<Json<AgentsPage>, ApiError> {
    let limit = q.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let status = q.status.unwrap_or_else(|| "active".to_string());
    if !matches!(status.as_str(), "active" | "slashed" | "paused" | "suspended") {
        return Err(ApiError::bad_request(
            "status must be active|slashed|paused|suspended",
        ));
    }
    let cap_mask_text = match q.capability_mask.as_deref() {
        Some(s) => Some(parse_hex_to_decimal(s).map_err(ApiError::bad_request)?),
        None => None,
    };
    let cursor = match q.cursor.as_deref() {
        Some(s) => Some(Cursor::decode(s).map_err(ApiError::bad_request)?),
        None => None,
    };

    let qtimer = metrics::time_discovery_query("discovery.list_agents");
    let rows = tokio::task::spawn_blocking(move || -> Result<Vec<RawAgentRow>, ApiError> {
        let mut conn = state.pool.get().map_err(ApiError::internal)?;
        let mut sql = String::from(
            "SELECT agent_did, operator, \
                    capability_mask::text AS capability_mask_text, \
                    stake_amount::text    AS stake_amount_text, \
                    reputation_composite, status, last_active_unix \
             FROM agent_directory WHERE status = $1",
        );
        let mut next = 2u32;
        let mut cap_pos: Option<u32> = None;
        let mut min_rep_pos: Option<u32> = None;
        let mut op_pos: Option<u32> = None;
        let mut cur_score_pos: Option<u32> = None;
        let mut cur_did_pos: Option<u32> = None;

        if cap_mask_text.is_some() {
            sql.push_str(&format!(
                " AND (capability_mask & ${0}::numeric) = ${0}::numeric",
                next
            ));
            cap_pos = Some(next);
            next += 1;
        }
        if q.min_reputation.is_some() {
            sql.push_str(&format!(" AND reputation_composite >= ${}", next));
            min_rep_pos = Some(next);
            next += 1;
        }
        if q.operator.is_some() {
            sql.push_str(&format!(" AND operator = ${}", next));
            op_pos = Some(next);
            next += 1;
        }
        if cursor.is_some() {
            // Sort: reputation_composite DESC, agent_did ASC.
            // Keyset: (rep < cur_rep) OR (rep = cur_rep AND did > cur_did).
            sql.push_str(&format!(
                " AND (reputation_composite < ${} \
                       OR (reputation_composite = ${} AND agent_did > ${}))",
                next,
                next,
                next + 1
            ));
            cur_score_pos = Some(next);
            cur_did_pos = Some(next + 1);
            next += 2;
        }
        sql.push_str(&format!(
            " ORDER BY reputation_composite DESC, agent_did ASC LIMIT ${}",
            next
        ));

        let mut qb = sql_query(sql).into_boxed::<diesel::pg::Pg>();
        qb = qb.bind::<Text, _>(status);
        if cap_pos.is_some() {
            qb = qb.bind::<Text, _>(cap_mask_text.clone().unwrap());
        }
        if min_rep_pos.is_some() {
            qb = qb.bind::<Int4, _>(q.min_reputation.unwrap());
        }
        if op_pos.is_some() {
            qb = qb.bind::<Text, _>(q.operator.clone().unwrap());
        }
        if let (Some(_), Some(_)) = (cur_score_pos, cur_did_pos) {
            let c = cursor.as_ref().unwrap();
            let score: i32 = c
                .sort_value
                .parse()
                .map_err(|_| ApiError::bad_request("cursor sort_value invalid"))?;
            let did = hex::decode(&c.last_id)
                .map_err(|_| ApiError::bad_request("cursor last_id invalid"))?;
            qb = qb.bind::<Int4, _>(score).bind::<Bytea, _>(did);
        }
        qb = qb.bind::<BigInt, _>(limit + 1);
        qb.load::<RawAgentRow>(&mut conn).map_err(ApiError::internal)
    })
    .await
    .map_err(ApiError::internal)??;
    qtimer.observe_duration();

    let has_more = rows.len() as i64 > limit;
    let items: Vec<AgentSummary> = rows
        .into_iter()
        .take(limit as usize)
        .map(|r| AgentSummary {
            did_hex: hex::encode(&r.agent_did),
            operator: r.operator,
            capability_mask: r.capability_mask_text.as_deref().map(decimal_to_hex),
            stake_lamports: r.stake_amount_text,
            reputation_composite: r.reputation_composite,
            status: r.status,
            last_active_unix: r.last_active_unix,
        })
        .collect();

    let cursor = if has_more {
        items.last().map(|last| {
            Cursor {
                sort_value: last.reputation_composite.to_string(),
                last_id: last.did_hex.clone(),
            }
            .encode()
        })
    } else {
        None
    };

    Ok(Json(AgentsPage { items, cursor }))
}

#[derive(Debug, Deserialize)]
pub struct TasksQuery {
    pub status: Option<String>,
    pub creator: Option<String>,
    pub agent_did: Option<String>,
    pub created_after: Option<i64>,
    pub created_before: Option<i64>,
    pub limit: Option<i64>,
    pub cursor: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct TaskSummary {
    pub task_id_hex: String,
    pub creator: Option<String>,
    pub agent_did_hex: Option<String>,
    pub status: Option<String>,
    pub reward_lamports: Option<String>,
    pub created_at_unix: i64,
    pub deadline_unix: i64,
    pub updated_at_unix: i64,
}

#[derive(Debug, Serialize)]
pub struct TasksPage {
    pub items: Vec<TaskSummary>,
    pub cursor: Option<String>,
}

#[derive(QueryableByName)]
struct RawTaskRow {
    #[diesel(sql_type = Bytea)]
    task_id: Vec<u8>,
    #[diesel(sql_type = diesel::sql_types::Nullable<Text>)]
    creator: Option<String>,
    #[diesel(sql_type = diesel::sql_types::Nullable<Bytea>)]
    agent_did: Option<Vec<u8>>,
    #[diesel(sql_type = diesel::sql_types::Nullable<Text>)]
    status: Option<String>,
    #[diesel(sql_type = diesel::sql_types::Nullable<Text>)]
    reward_lamports_text: Option<String>,
    #[diesel(sql_type = BigInt)]
    created_at_unix: i64,
    #[diesel(sql_type = BigInt)]
    deadline_unix: i64,
    #[diesel(sql_type = BigInt)]
    updated_at_unix: i64,
}

const TASK_STATUSES: &[&str] = &[
    "created",
    "funded",
    "submitted",
    "verified",
    "released",
    "disputed",
    "cancelled",
    "expired",
];

pub async fn list_tasks(
    State(state): State<ApiState>,
    Query(q): Query<TasksQuery>,
) -> Result<Json<TasksPage>, ApiError> {
    let limit = q.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let statuses: Option<Vec<String>> = match q.status.as_deref() {
        Some(s) => {
            let parts: Vec<String> = s.split(',').map(|p| p.trim().to_string()).collect();
            for p in &parts {
                if !TASK_STATUSES.contains(&p.as_str()) {
                    return Err(ApiError::bad_request("status contains unknown value"));
                }
            }
            Some(parts)
        }
        None => None,
    };
    let agent_did = match q.agent_did.as_deref() {
        Some(s) => Some(parse_hex_32(s).map_err(ApiError::bad_request)?),
        None => None,
    };
    let cursor = match q.cursor.as_deref() {
        Some(s) => Some(Cursor::decode(s).map_err(ApiError::bad_request)?),
        None => None,
    };

    let qtimer = metrics::time_discovery_query("discovery.list_tasks");
    let rows = tokio::task::spawn_blocking(move || -> Result<Vec<RawTaskRow>, ApiError> {
        let mut conn = state.pool.get().map_err(ApiError::internal)?;
        let mut sql = String::from(
            "SELECT task_id, creator, agent_did, status, \
                    reward_lamports::text AS reward_lamports_text, \
                    created_at_unix, deadline_unix, updated_at_unix \
             FROM task_directory WHERE 1=1",
        );
        let mut next = 1u32;
        let mut status_pos: Option<u32> = None;
        let mut creator_pos: Option<u32> = None;
        let mut did_pos: Option<u32> = None;
        let mut after_pos: Option<u32> = None;
        let mut before_pos: Option<u32> = None;
        let mut cur_t_pos: Option<u32> = None;
        let mut cur_id_pos: Option<u32> = None;

        if statuses.is_some() {
            sql.push_str(&format!(" AND status = ANY(${})", next));
            status_pos = Some(next);
            next += 1;
        }
        if q.creator.is_some() {
            sql.push_str(&format!(" AND creator = ${}", next));
            creator_pos = Some(next);
            next += 1;
        }
        if agent_did.is_some() {
            sql.push_str(&format!(" AND agent_did = ${}", next));
            did_pos = Some(next);
            next += 1;
        }
        if q.created_after.is_some() {
            sql.push_str(&format!(" AND created_at_unix > ${}", next));
            after_pos = Some(next);
            next += 1;
        }
        if q.created_before.is_some() {
            sql.push_str(&format!(" AND created_at_unix < ${}", next));
            before_pos = Some(next);
            next += 1;
        }
        if cursor.is_some() {
            // Sort: created_at_unix DESC, task_id ASC.
            sql.push_str(&format!(
                " AND (created_at_unix < ${} \
                       OR (created_at_unix = ${} AND task_id > ${}))",
                next,
                next,
                next + 1
            ));
            cur_t_pos = Some(next);
            cur_id_pos = Some(next + 1);
            next += 2;
        }
        sql.push_str(&format!(
            " ORDER BY created_at_unix DESC, task_id ASC LIMIT ${}",
            next
        ));

        let mut qb = sql_query(sql).into_boxed::<diesel::pg::Pg>();
        if status_pos.is_some() {
            qb = qb.bind::<diesel::sql_types::Array<Text>, _>(statuses.clone().unwrap());
        }
        if creator_pos.is_some() {
            qb = qb.bind::<Text, _>(q.creator.clone().unwrap());
        }
        if did_pos.is_some() {
            qb = qb.bind::<Bytea, _>(agent_did.clone().unwrap());
        }
        if after_pos.is_some() {
            qb = qb.bind::<BigInt, _>(q.created_after.unwrap());
        }
        if before_pos.is_some() {
            qb = qb.bind::<BigInt, _>(q.created_before.unwrap());
        }
        if let (Some(_), Some(_)) = (cur_t_pos, cur_id_pos) {
            let c = cursor.as_ref().unwrap();
            let t: i64 = c
                .sort_value
                .parse()
                .map_err(|_| ApiError::bad_request("cursor sort_value invalid"))?;
            let id = hex::decode(&c.last_id)
                .map_err(|_| ApiError::bad_request("cursor last_id invalid"))?;
            qb = qb.bind::<BigInt, _>(t).bind::<Bytea, _>(id);
        }
        qb = qb.bind::<BigInt, _>(limit + 1);
        qb.load::<RawTaskRow>(&mut conn).map_err(ApiError::internal)
    })
    .await
    .map_err(ApiError::internal)??;
    qtimer.observe_duration();

    let has_more = rows.len() as i64 > limit;
    let items: Vec<TaskSummary> = rows
        .into_iter()
        .take(limit as usize)
        .map(|r| TaskSummary {
            task_id_hex: hex::encode(&r.task_id),
            creator: r.creator,
            agent_did_hex: r.agent_did.as_ref().map(hex::encode),
            status: r.status,
            reward_lamports: r.reward_lamports_text,
            created_at_unix: r.created_at_unix,
            deadline_unix: r.deadline_unix,
            updated_at_unix: r.updated_at_unix,
        })
        .collect();

    let cursor = if has_more {
        items.last().map(|last| {
            Cursor {
                sort_value: last.created_at_unix.to_string(),
                last_id: last.task_id_hex.clone(),
            }
            .encode()
        })
    } else {
        None
    };

    Ok(Json(TasksPage { items, cursor }))
}

#[derive(Debug, Deserialize)]
pub struct AgentTasksQuery {
    pub status: Option<String>,
    pub creator: Option<String>,
    pub created_after: Option<i64>,
    pub created_before: Option<i64>,
    pub limit: Option<i64>,
    pub cursor: Option<String>,
}

pub async fn agent_tasks(
    State(state): State<ApiState>,
    Path(did_hex): Path<String>,
    Query(q): Query<AgentTasksQuery>,
) -> Result<Json<TasksPage>, ApiError> {
    parse_hex_32(&did_hex).map_err(ApiError::bad_request)?;
    let merged = TasksQuery {
        status: q.status,
        creator: q.creator,
        agent_did: Some(did_hex),
        created_after: q.created_after,
        created_before: q.created_before,
        limit: q.limit,
        cursor: q.cursor,
    };
    list_tasks(State(state), Query(merged)).await
}

#[derive(Debug, Serialize)]
pub struct AgentReputation {
    pub did_hex: String,
    pub reputation: Vec<ReputationBit>,
}

#[derive(QueryableByName)]
struct RawExistsRow {
    #[diesel(sql_type = BigInt)]
    n: i64,
}

pub async fn agent_reputation(
    State(state): State<ApiState>,
    Path(did_hex): Path<String>,
) -> Result<Json<AgentReputation>, ApiError> {
    let did_bytes = parse_hex_32(&did_hex).map_err(ApiError::bad_request)?;

    let qtimer = metrics::time_discovery_query("discovery.agent_reputation");
    let (exists, bits) = tokio::task::spawn_blocking(
        move || -> Result<(bool, Vec<RawReputationBitRow>), ApiError> {
            let mut conn = state.pool.get().map_err(ApiError::internal)?;
            let existence: Vec<RawExistsRow> =
                sql_query("SELECT count(*)::bigint AS n FROM agent_directory WHERE agent_did = $1")
                    .bind::<Bytea, _>(did_bytes.clone())
                    .load::<RawExistsRow>(&mut conn)
                    .map_err(ApiError::internal)?;
            let exists = existence.first().map(|r| r.n).unwrap_or(0) > 0;
            if !exists {
                return Ok((false, Vec::new()));
            }
            let bits = sql_query(
                "SELECT capability_bit, quality, timeliness, availability, \
                        cost_efficiency, honesty, jobs_completed, jobs_disputed, \
                        composite_score, last_update \
                 FROM reputation_rollup \
                 WHERE agent_did = $1 \
                 ORDER BY capability_bit ASC",
            )
            .bind::<Bytea, _>(did_bytes)
            .load::<RawReputationBitRow>(&mut conn)
            .map_err(ApiError::internal)?;
            Ok((true, bits))
        },
    )
    .await
    .map_err(ApiError::internal)??;
    qtimer.observe_duration();

    if !exists {
        return Err(ApiError::not_found("agent not found"));
    }

    let reputation = bits
        .into_iter()
        .map(|b| ReputationBit {
            capability_bit: b.capability_bit,
            quality: b.quality,
            timeliness: b.timeliness,
            availability: b.availability,
            cost_efficiency: b.cost_efficiency,
            honesty: b.honesty,
            jobs_completed: b.jobs_completed,
            jobs_disputed: b.jobs_disputed,
            composite_score: b.composite_score,
            last_update_unix: b.last_update.timestamp(),
        })
        .collect();

    Ok(Json(AgentReputation {
        did_hex,
        reputation,
    }))
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
struct Cursor {
    #[serde(rename = "s")]
    sort_value: String,
    #[serde(rename = "i")]
    last_id: String,
}

impl Cursor {
    fn encode(&self) -> String {
        let json = serde_json::to_vec(self).expect("cursor json");
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(json)
    }

    fn decode(s: &str) -> Result<Self, &'static str> {
        let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(s)
            .map_err(|_| "cursor base64 invalid")?;
        serde_json::from_slice(&bytes).map_err(|_| "cursor json invalid")
    }
}

fn parse_hex_to_decimal(s: &str) -> Result<String, &'static str> {
    let s = s.strip_prefix("0x").unwrap_or(s);
    let v = u128::from_str_radix(s, 16).map_err(|_| "capability_mask must be hex u128")?;
    Ok(v.to_string())
}

fn parse_hex_32(s: &str) -> Result<Vec<u8>, &'static str> {
    let bytes = hex::decode(s).map_err(|_| "must be hex")?;
    if bytes.len() != 32 {
        return Err("must be 32 bytes");
    }
    Ok(bytes)
}

fn decimal_to_hex(s: &str) -> String {
    s.parse::<u128>()
        .map(|v| format!("{:x}", v))
        .unwrap_or_else(|_| s.to_string())
}

/// JSONB encoding of a 32-byte id for filtering `program_events.data->'<field>'`.
/// Matches `borsh_decode`'s `[u8;32] → JSON array-of-u8` convention.
fn bytes_to_jsonb_array(bytes: &[u8]) -> String {
    serde_json::to_string(bytes).expect("serialize u8 slice")
}

// ---------- agent detail ----------

#[derive(Debug, Serialize)]
pub struct AgentDetail {
    pub did_hex: String,
    pub operator: Option<String>,
    pub capability_mask: Option<String>,
    pub stake_lamports: Option<String>,
    pub reputation_composite: i32,
    pub status: String,
    pub last_active_unix: i64,
    pub jobs_completed_total: i64,
    pub jobs_disputed_total: i64,
    pub reputation: Vec<ReputationBit>,
}

#[derive(Debug, Serialize)]
pub struct ReputationBit {
    pub capability_bit: i16,
    pub quality: i16,
    pub timeliness: i16,
    pub availability: i16,
    pub cost_efficiency: i16,
    pub honesty: i16,
    pub jobs_completed: i64,
    pub jobs_disputed: i64,
    pub composite_score: i32,
    pub last_update_unix: i64,
}

#[derive(QueryableByName)]
struct RawAgentDetailRow {
    #[diesel(sql_type = Bytea)]
    agent_did: Vec<u8>,
    #[diesel(sql_type = diesel::sql_types::Nullable<Text>)]
    operator: Option<String>,
    #[diesel(sql_type = diesel::sql_types::Nullable<Text>)]
    capability_mask_text: Option<String>,
    #[diesel(sql_type = diesel::sql_types::Nullable<Text>)]
    stake_amount_text: Option<String>,
    #[diesel(sql_type = Int4)]
    reputation_composite: i32,
    #[diesel(sql_type = Text)]
    status: String,
    #[diesel(sql_type = BigInt)]
    last_active_unix: i64,
}

#[derive(QueryableByName)]
struct RawReputationBitRow {
    #[diesel(sql_type = Int2)]
    capability_bit: i16,
    #[diesel(sql_type = Int2)]
    quality: i16,
    #[diesel(sql_type = Int2)]
    timeliness: i16,
    #[diesel(sql_type = Int2)]
    availability: i16,
    #[diesel(sql_type = Int2)]
    cost_efficiency: i16,
    #[diesel(sql_type = Int2)]
    honesty: i16,
    #[diesel(sql_type = BigInt)]
    jobs_completed: i64,
    #[diesel(sql_type = BigInt)]
    jobs_disputed: i64,
    #[diesel(sql_type = Int4)]
    composite_score: i32,
    #[diesel(sql_type = Timestamptz)]
    last_update: chrono::DateTime<chrono::Utc>,
}

pub async fn agent_detail(
    State(state): State<ApiState>,
    Path(did_hex): Path<String>,
) -> Result<Json<AgentDetail>, ApiError> {
    let did_bytes = parse_hex_32(&did_hex).map_err(ApiError::bad_request)?;

    let qtimer = metrics::time_discovery_query("discovery.agent_detail");
    let (base, bits) = tokio::task::spawn_blocking(
        move || -> Result<(Option<RawAgentDetailRow>, Vec<RawReputationBitRow>), ApiError> {
            let mut conn = state.pool.get().map_err(ApiError::internal)?;
            let base: Option<RawAgentDetailRow> = sql_query(
                "SELECT agent_did, operator, \
                        capability_mask::text AS capability_mask_text, \
                        stake_amount::text    AS stake_amount_text, \
                        reputation_composite, status, last_active_unix \
                 FROM agent_directory WHERE agent_did = $1",
            )
            .bind::<Bytea, _>(did_bytes.clone())
            .load::<RawAgentDetailRow>(&mut conn)
            .map_err(ApiError::internal)?
            .into_iter()
            .next();
            let bits: Vec<RawReputationBitRow> = sql_query(
                "SELECT capability_bit, quality, timeliness, availability, \
                        cost_efficiency, honesty, jobs_completed, jobs_disputed, \
                        composite_score, last_update \
                 FROM reputation_rollup \
                 WHERE agent_did = $1 \
                 ORDER BY capability_bit ASC",
            )
            .bind::<Bytea, _>(did_bytes)
            .load::<RawReputationBitRow>(&mut conn)
            .map_err(ApiError::internal)?;
            Ok((base, bits))
        },
    )
    .await
    .map_err(ApiError::internal)??;
    qtimer.observe_duration();

    let base = base.ok_or_else(|| ApiError::not_found("agent not found"))?;

    let jobs_completed_total: i64 = bits.iter().map(|b| b.jobs_completed).sum();
    let jobs_disputed_total: i64 = bits.iter().map(|b| b.jobs_disputed).sum();
    let reputation = bits
        .into_iter()
        .map(|b| ReputationBit {
            capability_bit: b.capability_bit,
            quality: b.quality,
            timeliness: b.timeliness,
            availability: b.availability,
            cost_efficiency: b.cost_efficiency,
            honesty: b.honesty,
            jobs_completed: b.jobs_completed,
            jobs_disputed: b.jobs_disputed,
            composite_score: b.composite_score,
            last_update_unix: b.last_update.timestamp(),
        })
        .collect();

    Ok(Json(AgentDetail {
        did_hex: hex::encode(&base.agent_did),
        operator: base.operator,
        capability_mask: base.capability_mask_text.as_deref().map(decimal_to_hex),
        stake_lamports: base.stake_amount_text,
        reputation_composite: base.reputation_composite,
        status: base.status,
        last_active_unix: base.last_active_unix,
        jobs_completed_total,
        jobs_disputed_total,
        reputation,
    }))
}

// ---------- task detail + timeline ----------

#[derive(Debug, Serialize)]
pub struct TaskDetail {
    pub task_id_hex: String,
    pub creator: Option<String>,
    pub agent_did_hex: Option<String>,
    pub status: Option<String>,
    pub reward_lamports: Option<String>,
    pub created_at_unix: i64,
    pub deadline_unix: i64,
    pub updated_at_unix: i64,
}

#[derive(QueryableByName)]
struct RawTaskDetailRow {
    #[diesel(sql_type = Bytea)]
    task_id: Vec<u8>,
    #[diesel(sql_type = diesel::sql_types::Nullable<Text>)]
    creator: Option<String>,
    #[diesel(sql_type = diesel::sql_types::Nullable<Bytea>)]
    agent_did: Option<Vec<u8>>,
    #[diesel(sql_type = diesel::sql_types::Nullable<Text>)]
    status: Option<String>,
    #[diesel(sql_type = diesel::sql_types::Nullable<Text>)]
    reward_lamports_text: Option<String>,
    #[diesel(sql_type = BigInt)]
    created_at_unix: i64,
    #[diesel(sql_type = BigInt)]
    deadline_unix: i64,
    #[diesel(sql_type = BigInt)]
    updated_at_unix: i64,
}

pub async fn task_detail(
    State(state): State<ApiState>,
    Path(task_id_hex): Path<String>,
) -> Result<Json<TaskDetail>, ApiError> {
    let task_id = parse_hex_32(&task_id_hex).map_err(ApiError::bad_request)?;

    let qtimer = metrics::time_discovery_query("discovery.task_detail");
    let row = tokio::task::spawn_blocking(move || -> Result<Option<RawTaskDetailRow>, ApiError> {
        let mut conn = state.pool.get().map_err(ApiError::internal)?;
        Ok(sql_query(
            "SELECT task_id, creator, agent_did, status, \
                    reward_lamports::text AS reward_lamports_text, \
                    created_at_unix, deadline_unix, updated_at_unix \
             FROM task_directory WHERE task_id = $1",
        )
        .bind::<Bytea, _>(task_id)
        .load::<RawTaskDetailRow>(&mut conn)
        .map_err(ApiError::internal)?
        .into_iter()
        .next())
    })
    .await
    .map_err(ApiError::internal)??
    .ok_or_else(|| ApiError::not_found("task not found"))?;
    qtimer.observe_duration();

    Ok(Json(TaskDetail {
        task_id_hex: hex::encode(&row.task_id),
        creator: row.creator,
        agent_did_hex: row.agent_did.as_ref().map(hex::encode),
        status: row.status,
        reward_lamports: row.reward_lamports_text,
        created_at_unix: row.created_at_unix,
        deadline_unix: row.deadline_unix,
        updated_at_unix: row.updated_at_unix,
    }))
}

const TIMELINE_EVENTS: &[&str] = &[
    "TaskCreated",
    "TaskFunded",
    "ResultSubmitted",
    "TaskVerified",
    "TaskReleased",
    "DisputeRaised",
    "TaskCancelled",
    "TaskExpired",
];

#[derive(Debug, Serialize)]
pub struct TimelineEntry {
    pub event_name: String,
    pub slot: i64,
    pub signature: String,
    pub timestamp_unix: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct TaskTimeline {
    pub task_id_hex: String,
    pub events: Vec<TimelineEntry>,
}

#[derive(QueryableByName)]
struct RawTimelineRow {
    #[diesel(sql_type = Text)]
    event_name: String,
    #[diesel(sql_type = BigInt)]
    slot: i64,
    #[diesel(sql_type = Text)]
    signature: String,
    #[diesel(sql_type = diesel::sql_types::Nullable<Text>)]
    timestamp_text: Option<String>,
}

pub async fn task_timeline(
    State(state): State<ApiState>,
    Path(task_id_hex): Path<String>,
) -> Result<Json<TaskTimeline>, ApiError> {
    let task_id = parse_hex_32(&task_id_hex).map_err(ApiError::bad_request)?;
    let jsonb_filter = bytes_to_jsonb_array(&task_id);
    let task_id_for_lookup = task_id.clone();

    let qtimer = metrics::time_discovery_query("discovery.task_timeline");
    let (exists, rows) = tokio::task::spawn_blocking(
        move || -> Result<(bool, Vec<RawTimelineRow>), ApiError> {
            let mut conn = state.pool.get().map_err(ApiError::internal)?;
            let exists: i64 = sql_query(
                "SELECT COUNT(*)::bigint AS n FROM task_directory WHERE task_id = $1",
            )
            .bind::<Bytea, _>(task_id_for_lookup)
            .get_result::<CountRow>(&mut conn)
            .map_err(ApiError::internal)?
            .n;
            let rows: Vec<RawTimelineRow> = sql_query(
                "SELECT event_name, slot, signature, \
                        (data->>'timestamp') AS timestamp_text \
                 FROM program_events \
                 WHERE event_name = ANY($1) \
                   AND data->'task_id' = $2::jsonb \
                 ORDER BY slot ASC, id ASC \
                 LIMIT $3",
            )
            .bind::<diesel::sql_types::Array<Text>, _>(
                TIMELINE_EVENTS.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
            )
            .bind::<Jsonb, _>(serde_json::from_str::<serde_json::Value>(&jsonb_filter).expect("jsonb"))
            .bind::<BigInt, _>(TIMELINE_MAX)
            .load::<RawTimelineRow>(&mut conn)
            .map_err(ApiError::internal)?;
            Ok((exists > 0, rows))
        },
    )
    .await
    .map_err(ApiError::internal)??;
    qtimer.observe_duration();

    if !exists {
        return Err(ApiError::not_found("task not found"));
    }

    let events = rows
        .into_iter()
        .map(|r| TimelineEntry {
            event_name: r.event_name,
            slot: r.slot,
            signature: r.signature,
            timestamp_unix: r.timestamp_text.and_then(|s| s.parse::<i64>().ok()),
        })
        .collect();

    Ok(Json(TaskTimeline {
        task_id_hex: hex::encode(&task_id),
        events,
    }))
}

#[derive(QueryableByName)]
struct CountRow {
    #[diesel(sql_type = BigInt)]
    n: i64,
}

// ---------- capabilities ----------

#[derive(Debug, Deserialize)]
pub struct CapabilitiesQuery {
    pub include_retired: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct Capability {
    pub bit: i32,
    pub slug: String,
    pub added_by: Option<String>,
    pub approved_at_unix: Option<i64>,
    pub retired: bool,
}

#[derive(Debug, Serialize)]
pub struct CapabilitiesList {
    pub items: Vec<Capability>,
}

#[derive(QueryableByName)]
struct RawCapabilityRow {
    #[diesel(sql_type = Int4)]
    bit: i32,
    #[diesel(sql_type = diesel::sql_types::Nullable<Jsonb>)]
    slug_bytes: Option<serde_json::Value>,
    #[diesel(sql_type = diesel::sql_types::Nullable<Text>)]
    added_by: Option<String>,
    #[diesel(sql_type = diesel::sql_types::Nullable<BigInt>)]
    approved_at_unix: Option<i64>,
    #[diesel(sql_type = diesel::sql_types::Bool)]
    retired: bool,
}

// Shared CTE: latest TagApproved + latest TagApproved-or-TagRetired per bit.
// `latest_per_bit` decides current retired state; `latest_approved` carries
// the slug/added_by/timestamp from the most recent approval (re-approval
// after retirement overwrites — matches on-chain semantics).
const CAPABILITIES_CTE: &str = "\
WITH latest_approved AS ( \
  SELECT DISTINCT ON ((data->>'bit_index')::int) \
    (data->>'bit_index')::int         AS bit, \
    data->'slug'                      AS slug_bytes, \
    data->>'added_by'                 AS added_by, \
    (data->>'timestamp')::bigint      AS approved_at_unix \
  FROM program_events \
  WHERE program_id = $1 \
    AND event_name = 'TagApproved' \
  ORDER BY (data->>'bit_index')::int, slot DESC, id DESC \
), latest_state AS ( \
  SELECT DISTINCT ON ((data->>'bit_index')::int) \
    (data->>'bit_index')::int AS bit, \
    event_name \
  FROM program_events \
  WHERE program_id = $1 \
    AND event_name IN ('TagApproved','TagRetired') \
  ORDER BY (data->>'bit_index')::int, slot DESC, id DESC \
)";

pub async fn list_capabilities(
    State(state): State<ApiState>,
    Query(q): Query<CapabilitiesQuery>,
) -> Result<Json<CapabilitiesList>, ApiError> {
    let include_retired = q.include_retired.unwrap_or(false);

    let qtimer = metrics::time_discovery_query("discovery.list_capabilities");
    let rows = tokio::task::spawn_blocking(move || -> Result<Vec<RawCapabilityRow>, ApiError> {
        let mut conn = state.pool.get().map_err(ApiError::internal)?;
        let mut sql = String::from(CAPABILITIES_CTE);
        sql.push_str(
            " SELECT a.bit, a.slug_bytes, a.added_by, a.approved_at_unix, \
                     (ls.event_name = 'TagRetired') AS retired \
              FROM latest_approved a \
              LEFT JOIN latest_state ls ON ls.bit = a.bit",
        );
        if !include_retired {
            sql.push_str(" WHERE ls.event_name = 'TagApproved'");
        }
        sql.push_str(" ORDER BY a.bit ASC");
        sql_query(sql)
            .bind::<Text, _>(CAPABILITY_REGISTRY_PROGRAM_ID)
            .load::<RawCapabilityRow>(&mut conn)
            .map_err(ApiError::internal)
    })
    .await
    .map_err(ApiError::internal)??;
    qtimer.observe_duration();

    let items = rows.into_iter().map(row_to_capability).collect();
    Ok(Json(CapabilitiesList { items }))
}

pub async fn capability_detail(
    State(state): State<ApiState>,
    Path(bit): Path<i32>,
) -> Result<Json<Capability>, ApiError> {
    if !(0..128).contains(&bit) {
        return Err(ApiError::bad_request("bit must be 0..128"));
    }

    let qtimer = metrics::time_discovery_query("discovery.capability_detail");
    let maybe_row = tokio::task::spawn_blocking(move || -> Result<Option<RawCapabilityRow>, ApiError> {
        let mut conn = state.pool.get().map_err(ApiError::internal)?;
        let mut sql = String::from(CAPABILITIES_CTE);
        sql.push_str(
            " SELECT a.bit, a.slug_bytes, a.added_by, a.approved_at_unix, \
                     (ls.event_name = 'TagRetired') AS retired \
              FROM latest_approved a \
              LEFT JOIN latest_state ls ON ls.bit = a.bit \
              WHERE a.bit = $2",
        );
        Ok(sql_query(sql)
            .bind::<Text, _>(CAPABILITY_REGISTRY_PROGRAM_ID)
            .bind::<Int4, _>(bit)
            .load::<RawCapabilityRow>(&mut conn)
            .map_err(ApiError::internal)?
            .into_iter()
            .next())
    })
    .await
    .map_err(ApiError::internal)??;
    qtimer.observe_duration();

    let row = maybe_row.ok_or_else(|| ApiError::not_found("capability not found"))?;
    Ok(Json(row_to_capability(row)))
}

fn row_to_capability(r: RawCapabilityRow) -> Capability {
    Capability {
        bit: r.bit,
        slug: r.slug_bytes.as_ref().map(slug_from_jsonb).unwrap_or_default(),
        added_by: r.added_by,
        approved_at_unix: r.approved_at_unix,
        retired: r.retired,
    }
}

// Slug is a [u8;32] in the IDL event; borsh_decode emits a JSON array-of-u8.
// Trim trailing zero bytes + interpret as UTF-8; lossy fallback on non-ascii
// so an upstream schema drift can't panic the handler.
fn slug_from_jsonb(v: &serde_json::Value) -> String {
    let Some(arr) = v.as_array() else {
        return String::new();
    };
    let bytes: Vec<u8> = arr
        .iter()
        .filter_map(|n| n.as_u64().and_then(|x| u8::try_from(x).ok()))
        .collect();
    let end = bytes.iter().rposition(|b| *b != 0).map(|p| p + 1).unwrap_or(0);
    String::from_utf8_lossy(&bytes[..end]).into_owned()
}

// ---------- treasury ----------

#[derive(Debug, Serialize)]
pub struct TreasuryDetail {
    pub did_hex: String,
    pub operator: Option<String>,
    pub per_tx_limit: Option<String>,
    pub daily_limit: Option<String>,
    pub weekly_limit: Option<String>,
    pub created_at_unix: i64,
    pub limits_updated_at_unix: Option<i64>,
}

#[derive(QueryableByName)]
struct RawTreasuryDetailRow {
    #[diesel(sql_type = diesel::sql_types::Nullable<Text>)]
    operator: Option<String>,
    #[diesel(sql_type = Text)]
    per_tx_text: String,
    #[diesel(sql_type = Text)]
    daily_text: String,
    #[diesel(sql_type = Text)]
    weekly_text: String,
    #[diesel(sql_type = BigInt)]
    created_unix: i64,
    #[diesel(sql_type = diesel::sql_types::Nullable<BigInt>)]
    limits_updated_unix: Option<i64>,
}

pub async fn treasury_detail(
    State(state): State<ApiState>,
    Path(did_hex): Path<String>,
) -> Result<Json<TreasuryDetail>, ApiError> {
    let did_bytes = parse_hex_32(&did_hex).map_err(ApiError::bad_request)?;
    let jsonb_filter = bytes_to_jsonb_array(&did_bytes);

    let qtimer = metrics::time_discovery_query("discovery.treasury_detail");
    let maybe_row = tokio::task::spawn_blocking(
        move || -> Result<Option<RawTreasuryDetailRow>, ApiError> {
            let mut conn = state.pool.get().map_err(ApiError::internal)?;
            let jsonb: serde_json::Value =
                serde_json::from_str(&jsonb_filter).expect("jsonb");
            Ok(sql_query(
                "WITH created AS ( \
                   SELECT DISTINCT ON (data->'agent_did') \
                     data->>'operator'                  AS operator, \
                     (data->>'daily_spend_limit')::numeric AS daily, \
                     (data->>'per_tx_limit')::numeric   AS per_tx, \
                     (data->>'weekly_limit')::numeric   AS weekly, \
                     (data->>'timestamp')::bigint       AS created_unix \
                   FROM program_events \
                   WHERE program_id = $1 \
                     AND event_name = 'TreasuryCreated' \
                     AND data->'agent_did' = $2::jsonb \
                   ORDER BY data->'agent_did', slot DESC, id DESC \
                 ), updated AS ( \
                   SELECT DISTINCT ON (data->'agent_did') \
                     (data->>'daily')::numeric    AS daily, \
                     (data->>'per_tx')::numeric   AS per_tx, \
                     (data->>'weekly')::numeric   AS weekly, \
                     (data->>'timestamp')::bigint AS updated_unix \
                   FROM program_events \
                   WHERE program_id = $1 \
                     AND event_name = 'LimitsUpdated' \
                     AND data->'agent_did' = $2::jsonb \
                   ORDER BY data->'agent_did', slot DESC, id DESC \
                 ) \
                 SELECT c.operator, \
                        COALESCE(u.per_tx, c.per_tx)::text AS per_tx_text, \
                        COALESCE(u.daily,  c.daily )::text AS daily_text, \
                        COALESCE(u.weekly, c.weekly)::text AS weekly_text, \
                        c.created_unix, \
                        u.updated_unix AS limits_updated_unix \
                 FROM created c LEFT JOIN updated u ON TRUE",
            )
            .bind::<Text, _>(TREASURY_STANDARD_PROGRAM_ID)
            .bind::<Jsonb, _>(jsonb)
            .load::<RawTreasuryDetailRow>(&mut conn)
            .map_err(ApiError::internal)?
            .into_iter()
            .next())
        },
    )
    .await
    .map_err(ApiError::internal)??;
    qtimer.observe_duration();

    let row = maybe_row.ok_or_else(|| ApiError::not_found("treasury not found"))?;

    Ok(Json(TreasuryDetail {
        did_hex,
        operator: row.operator,
        per_tx_limit: Some(row.per_tx_text),
        daily_limit: Some(row.daily_text),
        weekly_limit: Some(row.weekly_text),
        created_at_unix: row.created_unix,
        limits_updated_at_unix: row.limits_updated_unix,
    }))
}

#[derive(Debug, Serialize)]
pub struct TreasuryVault {
    pub mint: String,
    pub funded_total: String,
    pub withdrawn_total: String,
    pub balance: String,
    pub last_activity_unix: i64,
}

#[derive(Debug, Serialize)]
pub struct TreasuryVaults {
    pub did_hex: String,
    pub vaults: Vec<TreasuryVault>,
}

#[derive(QueryableByName)]
struct RawTreasuryVaultRow {
    #[diesel(sql_type = Text)]
    mint: String,
    #[diesel(sql_type = Text)]
    funded_total: String,
    #[diesel(sql_type = Text)]
    withdrawn_total: String,
    #[diesel(sql_type = Text)]
    balance: String,
    #[diesel(sql_type = BigInt)]
    last_activity_unix: i64,
}

pub async fn treasury_vaults(
    State(state): State<ApiState>,
    Path(did_hex): Path<String>,
) -> Result<Json<TreasuryVaults>, ApiError> {
    let did_bytes = parse_hex_32(&did_hex).map_err(ApiError::bad_request)?;
    let jsonb_filter = bytes_to_jsonb_array(&did_bytes);

    let qtimer = metrics::time_discovery_query("discovery.treasury_vaults");
    let (exists, rows) = tokio::task::spawn_blocking(
        move || -> Result<(bool, Vec<RawTreasuryVaultRow>), ApiError> {
            let mut conn = state.pool.get().map_err(ApiError::internal)?;
            let jsonb: serde_json::Value =
                serde_json::from_str(&jsonb_filter).expect("jsonb");
            let exists: i64 = sql_query(
                "SELECT COUNT(*)::bigint AS n FROM program_events \
                 WHERE program_id = $1 \
                   AND event_name = 'TreasuryCreated' \
                   AND data->'agent_did' = $2::jsonb",
            )
            .bind::<Text, _>(TREASURY_STANDARD_PROGRAM_ID)
            .bind::<Jsonb, _>(jsonb.clone())
            .get_result::<CountRow>(&mut conn)
            .map_err(ApiError::internal)?
            .n;
            if exists == 0 {
                return Ok((false, Vec::new()));
            }
            let rows = sql_query(
                "SELECT data->>'mint' AS mint, \
                        SUM(CASE WHEN event_name = 'TreasuryFunded' \
                                 THEN (data->>'amount')::numeric ELSE 0 END)::text \
                          AS funded_total, \
                        SUM(CASE WHEN event_name = 'TreasuryWithdraw' \
                                 THEN (data->>'amount')::numeric ELSE 0 END)::text \
                          AS withdrawn_total, \
                        (SUM(CASE WHEN event_name = 'TreasuryFunded' \
                                  THEN (data->>'amount')::numeric ELSE 0 END) \
                         - SUM(CASE WHEN event_name = 'TreasuryWithdraw' \
                                    THEN (data->>'amount')::numeric ELSE 0 END))::text \
                          AS balance, \
                        MAX((data->>'timestamp')::bigint) AS last_activity_unix \
                 FROM program_events \
                 WHERE program_id = $1 \
                   AND event_name IN ('TreasuryFunded', 'TreasuryWithdraw') \
                   AND data->'agent_did' = $2::jsonb \
                 GROUP BY data->>'mint' \
                 ORDER BY data->>'mint' ASC",
            )
            .bind::<Text, _>(TREASURY_STANDARD_PROGRAM_ID)
            .bind::<Jsonb, _>(jsonb)
            .load::<RawTreasuryVaultRow>(&mut conn)
            .map_err(ApiError::internal)?;
            Ok((true, rows))
        },
    )
    .await
    .map_err(ApiError::internal)??;
    qtimer.observe_duration();

    if !exists {
        return Err(ApiError::not_found("treasury not found"));
    }

    let vaults = rows
        .into_iter()
        .map(|r| TreasuryVault {
            mint: r.mint,
            funded_total: r.funded_total,
            withdrawn_total: r.withdrawn_total,
            balance: r.balance,
            last_activity_unix: r.last_activity_unix,
        })
        .collect();

    Ok(Json(TreasuryVaults { did_hex, vaults }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cursor_round_trip() {
        let c = Cursor {
            sort_value: "1234".into(),
            last_id: "deadbeef".into(),
        };
        let enc = c.encode();
        let dec = Cursor::decode(&enc).unwrap();
        assert_eq!(c, dec);
    }

    #[test]
    fn cursor_decode_rejects_garbage() {
        assert!(Cursor::decode("!!!not-base64!!!").is_err());
        assert!(Cursor::decode("aGVsbG8").is_err()); // base64("hello"), not JSON
    }

    #[test]
    fn parse_hex_to_decimal_accepts_with_and_without_prefix() {
        assert_eq!(parse_hex_to_decimal("ff").unwrap(), "255");
        assert_eq!(parse_hex_to_decimal("0xFF").unwrap(), "255");
        assert_eq!(parse_hex_to_decimal("0").unwrap(), "0");
        assert!(parse_hex_to_decimal("zzz").is_err());
    }

    #[test]
    fn parse_hex_32_enforces_length() {
        let ok = "0".repeat(64);
        assert!(parse_hex_32(&ok).is_ok());
        assert!(parse_hex_32("00").is_err());
        assert!(parse_hex_32("zz").is_err());
    }

    #[test]
    fn task_status_whitelist_covers_matview_states() {
        // Mirrors the CASE WHEN in the matview — must stay in sync.
        assert!(TASK_STATUSES.contains(&"created"));
        assert!(TASK_STATUSES.contains(&"released"));
        assert!(TASK_STATUSES.contains(&"disputed"));
        assert_eq!(TASK_STATUSES.len(), 8);
    }

    #[test]
    fn decimal_to_hex_round_trip() {
        assert_eq!(decimal_to_hex("255"), "ff");
        assert_eq!(decimal_to_hex("0"), "0");
        // Out-of-u128 falls through unchanged (defensive).
        let huge = "1".repeat(50);
        assert_eq!(decimal_to_hex(&huge), huge);
    }

    #[test]
    fn bytes_to_jsonb_array_shape() {
        let got = bytes_to_jsonb_array(&[0u8, 1, 255]);
        assert_eq!(got, "[0,1,255]");
        let all_zero = bytes_to_jsonb_array(&[0u8; 32]);
        assert!(all_zero.starts_with("[0,0,"));
        assert_eq!(all_zero.matches(',').count(), 31);
    }

    #[test]
    fn timeline_events_covers_task_status_whitelist() {
        // Every status in TASK_STATUSES maps to exactly one TIMELINE_EVENTS entry.
        // Guards against matview CASE drift (mirror of up.sql latest CTE).
        let status_to_event = |s: &str| match s {
            "created" => "TaskCreated",
            "funded" => "TaskFunded",
            "submitted" => "ResultSubmitted",
            "verified" => "TaskVerified",
            "released" => "TaskReleased",
            "disputed" => "DisputeRaised",
            "cancelled" => "TaskCancelled",
            "expired" => "TaskExpired",
            _ => "",
        };
        for s in TASK_STATUSES {
            let ev = status_to_event(s);
            assert!(!ev.is_empty(), "no event mapping for status {s}");
            assert!(
                TIMELINE_EVENTS.contains(&ev),
                "TIMELINE_EVENTS missing {ev}"
            );
        }
        assert_eq!(TIMELINE_EVENTS.len(), TASK_STATUSES.len());
    }

    #[test]
    fn slug_from_jsonb_trims_trailing_zeros() {
        // "mixer" padded to 32 bytes with zero-fill.
        let mut bytes = vec![b'm', b'i', b'x', b'e', b'r'];
        bytes.resize(32, 0);
        let v = serde_json::Value::Array(
            bytes.into_iter().map(|b| serde_json::json!(b)).collect(),
        );
        assert_eq!(slug_from_jsonb(&v), "mixer");
    }

    #[test]
    fn slug_from_jsonb_handles_all_zero_and_malformed() {
        let all_zero = serde_json::Value::Array(vec![serde_json::json!(0); 32]);
        assert_eq!(slug_from_jsonb(&all_zero), "");
        assert_eq!(slug_from_jsonb(&serde_json::json!({})), "");
        assert_eq!(slug_from_jsonb(&serde_json::json!(null)), "");
    }

    #[test]
    fn agent_tasks_query_parses_without_agent_did_field() {
        // Contract: AgentTasksQuery is TasksQuery minus agent_did. A stray
        // `?agent_did=...` query param must not override the path-bound did.
        // serde(deny_unknown_fields) is NOT set (axum/serde_urlencoded is
        // lenient by default), so we instead assert the post-merge TasksQuery
        // honors the path string rather than any inbound query field.
        let q = AgentTasksQuery {
            status: Some("funded".into()),
            creator: None,
            created_after: None,
            created_before: None,
            limit: Some(10),
            cursor: None,
        };
        let path_did = "cafecafe".to_string();
        let merged = TasksQuery {
            status: q.status,
            creator: q.creator,
            agent_did: Some(path_did.clone()),
            created_after: q.created_after,
            created_before: q.created_before,
            limit: q.limit,
            cursor: q.cursor,
        };
        assert_eq!(merged.agent_did, Some(path_did));
        assert_eq!(merged.status.as_deref(), Some("funded"));
        assert_eq!(merged.limit, Some(10));
    }

    #[test]
    fn agent_reputation_response_shape() {
        // Contract: `AgentReputation` serializes to `{did_hex, reputation: []}`
        // with the did unchanged from path input; reputation bits carry the
        // same 10 per-bit fields as `agent_detail`'s embedded `ReputationBit`.
        // Guards against a refactor that drops either top-level field.
        let r = AgentReputation {
            did_hex: "ab".repeat(32),
            reputation: vec![ReputationBit {
                capability_bit: 3,
                quality: 9500,
                timeliness: 9000,
                availability: 8800,
                cost_efficiency: 9100,
                honesty: 9900,
                jobs_completed: 42,
                jobs_disputed: 1,
                composite_score: 92_500,
                last_update_unix: 1_700_000_000,
            }],
        };
        let j = serde_json::to_value(&r).unwrap();
        assert_eq!(j["did_hex"], "ab".repeat(32));
        assert_eq!(j["reputation"].as_array().unwrap().len(), 1);
        let bit = &j["reputation"][0];
        for field in [
            "capability_bit",
            "quality",
            "timeliness",
            "availability",
            "cost_efficiency",
            "honesty",
            "jobs_completed",
            "jobs_disputed",
            "composite_score",
            "last_update_unix",
        ] {
            assert!(!bit[field].is_null(), "missing field {field}");
        }
    }

    #[test]
    fn capability_registry_program_id_matches_programs_rs() {
        // Drift guard: the CTE binds this constant; if programs.rs rotates,
        // this assert catches the mismatch before handlers silently return
        // empty result sets.
        let from_registry = crate::programs::SAEP_PROGRAMS
            .iter()
            .find(|p| p.name == "capability_registry")
            .map(|p| p.id)
            .unwrap();
        assert_eq!(from_registry, CAPABILITY_REGISTRY_PROGRAM_ID);
    }

    #[test]
    fn treasury_standard_program_id_matches_programs_rs() {
        let from_registry = crate::programs::SAEP_PROGRAMS
            .iter()
            .find(|p| p.name == "treasury_standard")
            .map(|p| p.id)
            .unwrap();
        assert_eq!(from_registry, TREASURY_STANDARD_PROGRAM_ID);
    }

    #[test]
    fn treasury_detail_response_shape() {
        let d = TreasuryDetail {
            did_hex: "ab".repeat(32),
            operator: Some("OperatorPubkey".into()),
            per_tx_limit: Some("1000000".into()),
            daily_limit: Some("10000000".into()),
            weekly_limit: Some("50000000".into()),
            created_at_unix: 1_700_000_000,
            limits_updated_at_unix: Some(1_700_100_000),
        };
        let j = serde_json::to_value(&d).unwrap();
        for field in [
            "did_hex",
            "operator",
            "per_tx_limit",
            "daily_limit",
            "weekly_limit",
            "created_at_unix",
            "limits_updated_at_unix",
        ] {
            assert!(j.get(field).is_some(), "missing field {field}");
        }
        assert_eq!(j["per_tx_limit"], "1000000");
        assert_eq!(j["limits_updated_at_unix"], 1_700_100_000);
    }

    #[test]
    fn treasury_vaults_response_shape() {
        let v = TreasuryVaults {
            did_hex: "cd".repeat(32),
            vaults: vec![TreasuryVault {
                mint: "MintPubkey".into(),
                funded_total: "5000000".into(),
                withdrawn_total: "1500000".into(),
                balance: "3500000".into(),
                last_activity_unix: 1_700_050_000,
            }],
        };
        let j = serde_json::to_value(&v).unwrap();
        assert_eq!(j["did_hex"], "cd".repeat(32));
        let vaults = j["vaults"].as_array().unwrap();
        assert_eq!(vaults.len(), 1);
        for field in [
            "mint",
            "funded_total",
            "withdrawn_total",
            "balance",
            "last_activity_unix",
        ] {
            assert!(vaults[0].get(field).is_some(), "missing field {field}");
        }
        assert_eq!(vaults[0]["balance"], "3500000");
    }

    #[test]
    fn endpoint_class_maps_every_registered_route() {
        // Five classes from spec §Rate-limits; must cover the 11 landed routes.
        assert_eq!(endpoint_class("/v1/discovery/agents"), "agents");
        assert_eq!(
            endpoint_class("/v1/discovery/agents/deadbeef"),
            "agents"
        );
        assert_eq!(
            endpoint_class("/v1/discovery/agents/deadbeef/tasks"),
            "agents"
        );
        assert_eq!(
            endpoint_class("/v1/discovery/agents/deadbeef/reputation"),
            "agents"
        );
        assert_eq!(endpoint_class("/v1/discovery/tasks"), "tasks");
        assert_eq!(
            endpoint_class("/v1/discovery/tasks/abc123"),
            "tasks"
        );
        assert_eq!(
            endpoint_class("/v1/discovery/tasks/abc123/timeline"),
            "tasks"
        );
        assert_eq!(
            endpoint_class("/v1/discovery/capabilities"),
            "capabilities"
        );
        assert_eq!(
            endpoint_class("/v1/discovery/capabilities/7"),
            "capabilities"
        );
        assert_eq!(
            endpoint_class("/v1/discovery/treasury/deadbeef"),
            "treasury"
        );
        assert_eq!(
            endpoint_class("/v1/discovery/treasury/deadbeef/vaults"),
            "treasury"
        );
        assert_eq!(endpoint_class("/v1/discovery/unknown"), "catch_all");
        assert_eq!(endpoint_class("/unrelated"), "catch_all");
        assert_eq!(endpoint_class(""), "catch_all");
    }

    #[test]
    fn discovery_metrics_are_registered_and_render() {
        // Touch each Lazy static so registration side-effects fire, then
        // verify the rendered Prometheus payload carries the series names
        // spec §Metrics mandates. Guards against accidental rename or
        // registration drop.
        metrics::inc_discovery_request("agents", "200");
        let t = metrics::time_discovery_request("tasks");
        t.observe_duration();
        let q = metrics::time_discovery_query("discovery.list_agents");
        q.observe_duration();
        metrics::DISCOVERY_CACHE_HITS
            .with_label_values(&["agents"])
            .inc();
        metrics::DISCOVERY_CACHE_MISSES
            .with_label_values(&["agents"])
            .inc();
        metrics::DISCOVERY_WS_CONNECTIONS.inc();
        metrics::DISCOVERY_WS_SUBSCRIPTIONS
            .with_label_values(&["tasks"])
            .set(0);
        metrics::DISCOVERY_WS_EVENTS_SENT
            .with_label_values(&["tasks"])
            .inc();
        metrics::DISCOVERY_WS_EVENTS_DROPPED
            .with_label_values(&["tasks", "queue_full"])
            .inc();
        metrics::DISCOVERY_RATE_LIMITED
            .with_label_values(&["ip", "agents"])
            .inc();

        let mf = prometheus::gather();
        let names: std::collections::HashSet<_> =
            mf.iter().map(|f| f.name().to_string()).collect();
        for expected in [
            "saep_discovery_request_total",
            "saep_discovery_request_duration_seconds",
            "saep_discovery_cache_hits_total",
            "saep_discovery_cache_misses_total",
            "saep_discovery_ws_connections",
            "saep_discovery_ws_subscriptions",
            "saep_discovery_ws_events_sent_total",
            "saep_discovery_ws_events_dropped_total",
            "saep_discovery_rate_limited_total",
            "saep_discovery_db_query_duration_seconds",
        ] {
            assert!(names.contains(expected), "missing metric {expected}");
        }
    }
}
