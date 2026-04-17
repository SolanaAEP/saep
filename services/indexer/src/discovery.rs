//! Discovery API — server-side filter + sort over `agent_directory` and
//! `task_directory` matviews (cycle-96 migration). Replaces browser-originated
//! `getProgramAccounts` memcmp scans for the portal `/marketplace` and `/tasks`
//! list views per `specs/discovery-api.md`.
//!
//! Cycle-98 scope: 2 GET endpoints (`/v1/discovery/agents`, `/v1/discovery/tasks`)
//! with default sort + opaque base64-JSON cursor pagination. Spec's full surface
//! (per-agent detail, timeline, capabilities, treasury, WS, rate-limiter, cache)
//! lands in subsequent cycles.

use axum::{
    extract::{Query, State},
    response::Json,
    routing::get,
    Router,
};
use base64::Engine;
use diesel::prelude::*;
use diesel::sql_query;
use diesel::sql_types::{BigInt, Bytea, Int4, Text};
use serde::{Deserialize, Serialize};

use crate::api::{ApiError, ApiState};

const DEFAULT_LIMIT: i64 = 50;
const MAX_LIMIT: i64 = 200;

pub fn router(state: ApiState) -> Router {
    Router::new()
        .route("/v1/discovery/agents", get(list_agents))
        .route("/v1/discovery/tasks", get(list_tasks))
        .with_state(state)
}

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
}
