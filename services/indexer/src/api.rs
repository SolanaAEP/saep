//! Read-only REST surface the portal consumes for leaderboard + per-agent
//! reputation lookups. All queries hit the `reputation_rollup` materialized
//! view (refreshed every 60s by `jobs::reputation_rollup::run`).
//!
//! Raw SQL via `sql_query` rather than diesel DSL — `src/schema.rs` only tracks
//! the legacy event-log tables; reputation tables live in migrations and don't
//! round-trip through `diesel print-schema` yet.

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Json},
    routing::get,
    Router,
};
use diesel::prelude::*;
use diesel::sql_query;
use diesel::sql_types::{BigInt, Bytea, Int2, Int4, Integer, Nullable, Text, Timestamptz};
use serde::{Deserialize, Serialize};

use crate::db::PgPool;

const DEFAULT_LIMIT: u32 = 50;
const MAX_LIMIT: u32 = 500;

#[derive(Clone)]
pub struct ApiState {
    pub pool: PgPool,
}

pub fn router(pool: PgPool) -> Router {
    Router::new()
        .route("/leaderboard", get(leaderboard))
        .route("/agents/:did/reputation", get(agent_reputation))
        .route("/retro/eligibility/:operator", get(retro_eligibility))
        .with_state(ApiState { pool })
}

#[derive(Debug, Deserialize)]
pub struct LeaderboardQuery {
    pub capability: i16,
    pub limit: Option<u32>,
    pub cursor: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct LeaderboardRow {
    pub agent_did_hex: String,
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

#[derive(QueryableByName, Debug)]
struct RawLeaderboardRow {
    #[diesel(sql_type = Bytea)]
    agent_did: Vec<u8>,
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

impl From<RawLeaderboardRow> for LeaderboardRow {
    fn from(r: RawLeaderboardRow) -> Self {
        Self {
            agent_did_hex: hex::encode(&r.agent_did),
            capability_bit: r.capability_bit,
            quality: r.quality,
            timeliness: r.timeliness,
            availability: r.availability,
            cost_efficiency: r.cost_efficiency,
            honesty: r.honesty,
            jobs_completed: r.jobs_completed,
            jobs_disputed: r.jobs_disputed,
            composite_score: r.composite_score,
            last_update_unix: r.last_update.timestamp(),
        }
    }
}

pub async fn leaderboard(
    State(state): State<ApiState>,
    Query(q): Query<LeaderboardQuery>,
) -> Result<Json<Vec<LeaderboardRow>>, ApiError> {
    let limit = q.limit.unwrap_or(DEFAULT_LIMIT).min(MAX_LIMIT) as i64;
    let rows = tokio::task::spawn_blocking(move || -> Result<Vec<RawLeaderboardRow>, ApiError> {
        let mut conn = state.pool.get().map_err(ApiError::internal)?;
        let rows = match q.cursor {
            Some(cursor) => sql_query(
                "SELECT agent_did, capability_bit, quality, timeliness, availability,
                        cost_efficiency, honesty, jobs_completed, jobs_disputed,
                        composite_score, last_update
                 FROM reputation_rollup
                 WHERE capability_bit = $1 AND composite_score < $2
                 ORDER BY composite_score DESC
                 LIMIT $3",
            )
            .bind::<Int2, _>(q.capability)
            .bind::<Int4, _>(cursor as i32)
            .bind::<BigInt, _>(limit)
            .load::<RawLeaderboardRow>(&mut conn),
            None => sql_query(
                "SELECT agent_did, capability_bit, quality, timeliness, availability,
                        cost_efficiency, honesty, jobs_completed, jobs_disputed,
                        composite_score, last_update
                 FROM reputation_rollup
                 WHERE capability_bit = $1
                 ORDER BY composite_score DESC
                 LIMIT $2",
            )
            .bind::<Int2, _>(q.capability)
            .bind::<BigInt, _>(limit)
            .load::<RawLeaderboardRow>(&mut conn),
        };
        rows.map_err(ApiError::internal)
    })
    .await
    .map_err(ApiError::internal)??;
    Ok(Json(rows.into_iter().map(LeaderboardRow::from).collect()))
}

pub async fn agent_reputation(
    State(state): State<ApiState>,
    Path(did_hex): Path<String>,
) -> Result<Json<Vec<LeaderboardRow>>, ApiError> {
    let did_bytes = hex::decode(&did_hex).map_err(|_| ApiError::bad_request("did must be hex"))?;
    if did_bytes.len() != 32 {
        return Err(ApiError::bad_request("did must be 32 bytes"));
    }
    let rows = tokio::task::spawn_blocking(move || -> Result<Vec<RawLeaderboardRow>, ApiError> {
        let mut conn = state.pool.get().map_err(ApiError::internal)?;
        sql_query(
            "SELECT agent_did, capability_bit, quality, timeliness, availability,
                    cost_efficiency, honesty, jobs_completed, jobs_disputed,
                    composite_score, last_update
             FROM reputation_rollup
             WHERE agent_did = $1
             ORDER BY capability_bit ASC",
        )
        .bind::<Bytea, _>(did_bytes)
        .load::<RawLeaderboardRow>(&mut conn)
        .map_err(ApiError::internal)
    })
    .await
    .map_err(ApiError::internal)??;
    Ok(Json(rows.into_iter().map(LeaderboardRow::from).collect()))
}

#[derive(Debug, Serialize)]
pub struct RetroEligibilityRow {
    pub operator_hex: String,
    pub net_fees_micro_usdc: i64,
    pub wash_excluded_micro_usdc: i64,
    pub personhood_tier: String,
    pub personhood_multiplier: String,
    pub cold_start_multiplier: String,
    pub estimated_allocation: Option<String>,
    pub epoch_first_seen: i32,
    pub last_updated_unix: i64,
}

#[derive(QueryableByName, Debug)]
struct RawRetroRow {
    #[diesel(sql_type = Bytea)]
    operator: Vec<u8>,
    #[diesel(sql_type = BigInt)]
    net_fees_micro_usdc: i64,
    #[diesel(sql_type = BigInt)]
    wash_excluded_micro_usdc: i64,
    #[diesel(sql_type = Text)]
    personhood_tier: String,
    #[diesel(sql_type = Text)]
    personhood_multiplier_text: String,
    #[diesel(sql_type = Text)]
    cold_start_multiplier_text: String,
    #[diesel(sql_type = Nullable<Text>)]
    estimated_allocation_text: Option<String>,
    #[diesel(sql_type = Integer)]
    epoch_first_seen: i32,
    #[diesel(sql_type = Timestamptz)]
    last_updated: chrono::DateTime<chrono::Utc>,
}

pub async fn retro_eligibility(
    State(state): State<ApiState>,
    Path(operator_hex): Path<String>,
) -> Result<Json<RetroEligibilityRow>, ApiError> {
    let op_bytes =
        hex::decode(&operator_hex).map_err(|_| ApiError::bad_request("operator must be hex"))?;
    if op_bytes.len() != 32 {
        return Err(ApiError::bad_request("operator must be 32 bytes"));
    }
    let raw = tokio::task::spawn_blocking(move || -> Result<Option<RawRetroRow>, ApiError> {
        let mut conn = state.pool.get().map_err(ApiError::internal)?;
        sql_query(
            "SELECT operator,
                    net_fees_micro_usdc,
                    wash_excluded_micro_usdc,
                    personhood_tier,
                    personhood_multiplier::text AS personhood_multiplier_text,
                    cold_start_multiplier::text AS cold_start_multiplier_text,
                    estimated_allocation::text AS estimated_allocation_text,
                    epoch_first_seen,
                    last_updated
             FROM retro_eligibility
             WHERE operator = $1",
        )
        .bind::<Bytea, _>(op_bytes)
        .get_result::<RawRetroRow>(&mut conn)
        .optional()
        .map_err(ApiError::internal)
    })
    .await
    .map_err(ApiError::internal)??;
    let row = raw.ok_or_else(|| ApiError::not_found("no eligibility record for operator"))?;
    Ok(Json(RetroEligibilityRow {
        operator_hex: hex::encode(&row.operator),
        net_fees_micro_usdc: row.net_fees_micro_usdc,
        wash_excluded_micro_usdc: row.wash_excluded_micro_usdc,
        personhood_tier: row.personhood_tier,
        personhood_multiplier: row.personhood_multiplier_text,
        cold_start_multiplier: row.cold_start_multiplier_text,
        estimated_allocation: row.estimated_allocation_text,
        epoch_first_seen: row.epoch_first_seen,
        last_updated_unix: row.last_updated.timestamp(),
    }))
}

#[derive(Debug)]
pub struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    fn internal<E: std::fmt::Display>(e: E) -> Self {
        tracing::error!(error = %e, "indexer api internal error");
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: "internal error".into(),
        }
    }
    fn bad_request(msg: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: msg.into(),
        }
    }
    fn not_found(msg: impl Into<String>) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message: msg.into(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        (self.status, Json(serde_json::json!({ "error": self.message }))).into_response()
    }
}
