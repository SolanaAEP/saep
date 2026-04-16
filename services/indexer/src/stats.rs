//! Aggregated read-only stats for the public analytics page.
//!
//! All queries hit the event log (`program_events`) plus `category_reputation`.
//! Numbers are kept as `i64` lamports/counts; SOL conversion happens client-side.
//! u64 fields decoded by `borsh_decode` arrive as JSON strings — `::numeric`
//! casts handle that.

use axum::{
    extract::{Query, State},
    response::Json,
    routing::get,
    Router,
};
use diesel::prelude::*;
use diesel::sql_query;
use diesel::sql_types::{BigInt, Bytea, Int2, Int4, Text};
use serde::{Deserialize, Serialize};

use crate::api::{ApiError, ApiState};

const MAX_LIMIT: u32 = 500;

pub fn router(state: ApiState) -> Router {
    Router::new()
        .route("/stats/totals", get(totals))
        .route("/stats/tasks-per-day", get(tasks_per_day))
        .route("/stats/top-capabilities", get(top_capabilities))
        .route("/stats/fees-burned", get(fees_burned))
        .route("/stats/network-health", get(network_health))
        .route("/stats/top-agents", get(top_agents))
        .route("/stats/agent-graph", get(agent_graph))
        .with_state(state)
}

#[derive(Debug, Serialize, QueryableByName)]
pub struct Totals {
    #[diesel(sql_type = BigInt)]
    pub agents: i64,
    #[diesel(sql_type = BigInt)]
    pub tasks: i64,
    #[diesel(sql_type = BigInt)]
    pub volume_lamports: i64,
    #[diesel(sql_type = BigInt)]
    pub active_streams: i64,
}

pub async fn totals(State(state): State<ApiState>) -> Result<Json<Totals>, ApiError> {
    let row = tokio::task::spawn_blocking(move || -> Result<Totals, ApiError> {
        let mut conn = state.pool.get().map_err(ApiError::internal)?;
        sql_query(
            "SELECT
                (SELECT COUNT(DISTINCT data->>'agent_did')
                   FROM program_events WHERE event_name='AgentRegistered')::bigint AS agents,
                (SELECT COUNT(*) FROM program_events WHERE event_name='TaskCreated')::bigint AS tasks,
                COALESCE((SELECT SUM((data->>'agent_payout')::numeric)
                            FROM program_events WHERE event_name='TaskReleased'), 0)::bigint
                  AS volume_lamports,
                GREATEST(
                  (SELECT COUNT(*) FROM program_events WHERE event_name='StreamInitialized')
                  - (SELECT COUNT(*) FROM program_events WHERE event_name='StreamClosed'),
                  0
                )::bigint AS active_streams",
        )
        .get_result::<Totals>(&mut conn)
        .map_err(ApiError::internal)
    })
    .await
    .map_err(ApiError::internal)??;
    Ok(Json(row))
}

#[derive(Debug, Deserialize)]
pub struct DaysQuery {
    pub days: Option<u32>,
}

#[derive(Debug, Serialize, QueryableByName)]
pub struct DayBucket {
    #[diesel(sql_type = Text)]
    pub day: String,
    #[diesel(sql_type = BigInt)]
    pub tasks: i64,
}

pub async fn tasks_per_day(
    State(state): State<ApiState>,
    Query(q): Query<DaysQuery>,
) -> Result<Json<Vec<DayBucket>>, ApiError> {
    let days = q.days.unwrap_or(30).clamp(1, 180) as i32;
    let rows = tokio::task::spawn_blocking(move || -> Result<Vec<DayBucket>, ApiError> {
        let mut conn = state.pool.get().map_err(ApiError::internal)?;
        sql_query(
            "WITH series AS (
               SELECT generate_series(
                 date_trunc('day', now()) - ($1::int - 1) * interval '1 day',
                 date_trunc('day', now()),
                 interval '1 day'
               ) AS day
             ),
             counts AS (
               SELECT date_trunc('day', ingested_at) AS day, COUNT(*)::bigint AS tasks
                 FROM program_events
                WHERE event_name='TaskCreated'
                  AND ingested_at >= date_trunc('day', now()) - ($1::int - 1) * interval '1 day'
                GROUP BY 1
             )
             SELECT to_char(s.day, 'MM-DD') AS day,
                    COALESCE(c.tasks, 0)::bigint AS tasks
               FROM series s
               LEFT JOIN counts c ON c.day = s.day
              ORDER BY s.day",
        )
        .bind::<Int4, _>(days)
        .load::<DayBucket>(&mut conn)
        .map_err(ApiError::internal)
    })
    .await
    .map_err(ApiError::internal)??;
    Ok(Json(rows))
}

#[derive(Debug, Deserialize)]
pub struct LimitQuery {
    pub limit: Option<u32>,
}

#[derive(Debug, Serialize, QueryableByName)]
pub struct CapabilityCount {
    #[diesel(sql_type = Int2)]
    pub capability_bit: i16,
    #[diesel(sql_type = BigInt)]
    pub tasks: i64,
}

pub async fn top_capabilities(
    State(state): State<ApiState>,
    Query(q): Query<LimitQuery>,
) -> Result<Json<Vec<CapabilityCount>>, ApiError> {
    let limit = q.limit.unwrap_or(10).min(MAX_LIMIT) as i64;
    let rows = tokio::task::spawn_blocking(move || -> Result<Vec<CapabilityCount>, ApiError> {
        let mut conn = state.pool.get().map_err(ApiError::internal)?;
        sql_query(
            "SELECT capability_bit, COUNT(*)::bigint AS tasks
               FROM reputation_samples
              WHERE completed = true
              GROUP BY capability_bit
              ORDER BY tasks DESC
              LIMIT $1",
        )
        .bind::<BigInt, _>(limit)
        .load::<CapabilityCount>(&mut conn)
        .map_err(ApiError::internal)
    })
    .await
    .map_err(ApiError::internal)??;
    Ok(Json(rows))
}

#[derive(Debug, Serialize, QueryableByName)]
pub struct FeesBurned {
    #[diesel(sql_type = BigInt)]
    pub protocol_fees_lamports: i64,
    #[diesel(sql_type = BigInt)]
    pub solrep_fees_lamports: i64,
    #[diesel(sql_type = BigInt)]
    pub last_24h_lamports: i64,
}

pub async fn fees_burned(State(state): State<ApiState>) -> Result<Json<FeesBurned>, ApiError> {
    let row = tokio::task::spawn_blocking(move || -> Result<FeesBurned, ApiError> {
        let mut conn = state.pool.get().map_err(ApiError::internal)?;
        sql_query(
            "SELECT
                COALESCE(SUM((data->>'protocol_fee')::numeric), 0)::bigint AS protocol_fees_lamports,
                COALESCE(SUM((data->>'solrep_fee')::numeric), 0)::bigint   AS solrep_fees_lamports,
                COALESCE(SUM(CASE WHEN ingested_at >= now() - interval '24 hours'
                                  THEN (data->>'protocol_fee')::numeric ELSE 0 END), 0)::bigint
                  AS last_24h_lamports
             FROM program_events
             WHERE event_name='TaskReleased'",
        )
        .get_result::<FeesBurned>(&mut conn)
        .map_err(ApiError::internal)
    })
    .await
    .map_err(ApiError::internal)??;
    Ok(Json(row))
}

#[derive(Debug, Serialize, QueryableByName)]
pub struct NetworkHealth {
    #[diesel(sql_type = BigInt)]
    pub latest_slot: i64,
    #[diesel(sql_type = BigInt)]
    pub reorgs_24h: i64,
    #[diesel(sql_type = BigInt)]
    pub events_per_min: i64,
    #[diesel(sql_type = BigInt)]
    pub events_total: i64,
    #[diesel(sql_type = BigInt)]
    pub blocks_total: i64,
}

pub async fn network_health(
    State(state): State<ApiState>,
) -> Result<Json<NetworkHealth>, ApiError> {
    let row = tokio::task::spawn_blocking(move || -> Result<NetworkHealth, ApiError> {
        let mut conn = state.pool.get().map_err(ApiError::internal)?;
        sql_query(
            "SELECT
                COALESCE((SELECT MAX(slot) FROM blocks), 0)::bigint AS latest_slot,
                (SELECT COUNT(*) FROM reorg_log
                  WHERE detected_at >= now() - interval '24 hours')::bigint AS reorgs_24h,
                (SELECT COUNT(*) FROM program_events
                  WHERE ingested_at >= now() - interval '1 minute')::bigint AS events_per_min,
                (SELECT COUNT(*) FROM program_events)::bigint AS events_total,
                (SELECT COUNT(*) FROM blocks)::bigint AS blocks_total",
        )
        .get_result::<NetworkHealth>(&mut conn)
        .map_err(ApiError::internal)
    })
    .await
    .map_err(ApiError::internal)??;
    Ok(Json(row))
}

#[derive(Debug, Serialize)]
pub struct TopAgent {
    pub agent_did_hex: String,
    pub avg_score: i32,
    pub jobs_completed: i64,
    pub categories: i64,
}

#[derive(QueryableByName)]
struct RawTopAgent {
    #[diesel(sql_type = Bytea)]
    agent_did: Vec<u8>,
    #[diesel(sql_type = Int4)]
    avg_score: i32,
    #[diesel(sql_type = BigInt)]
    jobs_completed: i64,
    #[diesel(sql_type = BigInt)]
    categories: i64,
}

pub async fn top_agents(
    State(state): State<ApiState>,
    Query(q): Query<LimitQuery>,
) -> Result<Json<Vec<TopAgent>>, ApiError> {
    let limit = q.limit.unwrap_or(10).min(MAX_LIMIT) as i64;
    let rows = tokio::task::spawn_blocking(move || -> Result<Vec<RawTopAgent>, ApiError> {
        let mut conn = state.pool.get().map_err(ApiError::internal)?;
        sql_query(
            "SELECT agent_did,
                    AVG(composite_score)::int AS avg_score,
                    SUM(jobs_completed)::bigint AS jobs_completed,
                    COUNT(*)::bigint AS categories
               FROM reputation_rollup
              GROUP BY agent_did
              ORDER BY avg_score DESC, jobs_completed DESC
              LIMIT $1",
        )
        .bind::<BigInt, _>(limit)
        .load::<RawTopAgent>(&mut conn)
        .map_err(ApiError::internal)
    })
    .await
    .map_err(ApiError::internal)??;
    Ok(Json(
        rows.into_iter()
            .map(|r| TopAgent {
                agent_did_hex: hex::encode(&r.agent_did),
                avg_score: r.avg_score,
                jobs_completed: r.jobs_completed,
                categories: r.categories,
            })
            .collect(),
    ))
}

#[derive(Debug, Serialize)]
pub struct AgentGraph {
    pub agents: Vec<GraphAgent>,
    pub edges: Vec<GraphEdge>,
}

#[derive(Debug, Serialize)]
pub struct GraphAgent {
    pub agent_did_hex: String,
    pub jobs_completed: i64,
    pub avg_score: i32,
}

#[derive(Debug, Serialize)]
pub struct GraphEdge {
    pub agent_did_hex: String,
    pub capability_bit: i16,
    pub composite_score: i32,
}

#[derive(QueryableByName)]
struct RawGraphAgent {
    #[diesel(sql_type = Bytea)]
    agent_did: Vec<u8>,
    #[diesel(sql_type = BigInt)]
    jobs_completed: i64,
    #[diesel(sql_type = Int4)]
    avg_score: i32,
}

#[derive(QueryableByName)]
struct RawGraphEdge {
    #[diesel(sql_type = Bytea)]
    agent_did: Vec<u8>,
    #[diesel(sql_type = Int2)]
    capability_bit: i16,
    #[diesel(sql_type = Int4)]
    composite_score: i32,
}

pub async fn agent_graph(
    State(state): State<ApiState>,
    Query(q): Query<LimitQuery>,
) -> Result<Json<AgentGraph>, ApiError> {
    let limit = q.limit.unwrap_or(40).min(200) as i64;
    let (agents, edges) =
        tokio::task::spawn_blocking(move || -> Result<(Vec<RawGraphAgent>, Vec<RawGraphEdge>), ApiError> {
            let mut conn = state.pool.get().map_err(ApiError::internal)?;
            let agents = sql_query(
                "SELECT agent_did,
                        SUM(jobs_completed)::bigint AS jobs_completed,
                        AVG(composite_score)::int AS avg_score
                   FROM reputation_rollup
                  GROUP BY agent_did
                  ORDER BY avg_score DESC, jobs_completed DESC
                  LIMIT $1",
            )
            .bind::<BigInt, _>(limit)
            .load::<RawGraphAgent>(&mut conn)
            .map_err(ApiError::internal)?;
            let edges = sql_query(
                "SELECT r.agent_did, r.capability_bit, r.composite_score
                   FROM reputation_rollup r
                   JOIN (
                     SELECT agent_did
                       FROM reputation_rollup
                      GROUP BY agent_did
                      ORDER BY AVG(composite_score) DESC, SUM(jobs_completed) DESC
                      LIMIT $1
                   ) top ON top.agent_did = r.agent_did",
            )
            .bind::<BigInt, _>(limit)
            .load::<RawGraphEdge>(&mut conn)
            .map_err(ApiError::internal)?;
            Ok((agents, edges))
        })
        .await
        .map_err(ApiError::internal)??;
    Ok(Json(AgentGraph {
        agents: agents
            .into_iter()
            .map(|a| GraphAgent {
                agent_did_hex: hex::encode(&a.agent_did),
                jobs_completed: a.jobs_completed,
                avg_score: a.avg_score,
            })
            .collect(),
        edges: edges
            .into_iter()
            .map(|e| GraphEdge {
                agent_did_hex: hex::encode(&e.agent_did),
                capability_bit: e.capability_bit,
                composite_score: e.composite_score,
            })
            .collect(),
    }))
}
