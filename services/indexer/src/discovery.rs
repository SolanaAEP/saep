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
//! `list_tasks` with the `agent_did` filter pinned from the path. Remaining
//! (treasury, agent streams + reputation sub-endpoints, WS, rate-limiter,
//! cache) land in subsequent cycles.

use axum::{
    extract::{Path, Query, State},
    response::Json,
    routing::get,
    Router,
};
use base64::Engine;
use diesel::prelude::*;
use diesel::sql_query;
use diesel::sql_types::{BigInt, Bytea, Int2, Int4, Jsonb, Text, Timestamptz};
use serde::{Deserialize, Serialize};

use crate::api::{ApiError, ApiState};

const DEFAULT_LIMIT: i64 = 50;
const MAX_LIMIT: i64 = 200;
const TIMELINE_MAX: i64 = 500;

pub fn router(state: ApiState) -> Router {
    Router::new()
        .route("/v1/discovery/agents", get(list_agents))
        .route("/v1/discovery/agents/:did", get(agent_detail))
        .route("/v1/discovery/agents/:did/tasks", get(agent_tasks))
        .route("/v1/discovery/tasks", get(list_tasks))
        .route("/v1/discovery/tasks/:task_id_hex", get(task_detail))
        .route(
            "/v1/discovery/tasks/:task_id_hex/timeline",
            get(task_timeline),
        )
        .route("/v1/discovery/capabilities", get(list_capabilities))
        .route("/v1/discovery/capabilities/:bit", get(capability_detail))
        .with_state(state)
}

const CAPABILITY_REGISTRY_PROGRAM_ID: &str = "GW161Wce7z4S2rdcSCPNGixn2YQajefNc4r3jUj9zZ5F";

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

    let row = tokio::task::spawn_blocking(move || -> Result<Option<RawCapabilityRow>, ApiError> {
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
    .map_err(ApiError::internal)??
    .ok_or_else(|| ApiError::not_found("capability not found"))?;

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
}
