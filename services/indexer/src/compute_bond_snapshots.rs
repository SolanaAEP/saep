use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    response::Json,
    routing::{get, post},
    Router,
};
use diesel::prelude::*;
use diesel::sql_query;
use diesel::sql_types::{Array, BigInt, Integer, Nullable, Text};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::api::{ApiError, ApiState};
use crate::db::PgPool;

const BOND_STATUSES: &[&str] = &[
    "reserved",
    "locked",
    "released",
    "slashed",
    "cancelled",
    "expired",
];
const BOND_PROVIDERS: &[&str] = &["ionet", "akash"];
const DEFAULT_LIMIT: i64 = 50;
const MAX_LIMIT: i64 = 200;

#[derive(Clone)]
pub struct InternalApiState {
    pub pool: PgPool,
    pub token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ComputeBondSummary {
    pub lease_id: String,
    pub agent_did: String,
    pub provider: String,
    pub gpu_hours: i32,
    pub expires_at: i64,
    pub slashable_until: i64,
    pub task_id: Option<String>,
    pub status: String,
    pub status_reason: Option<String>,
    pub reserved_price_usd_micro: Option<i64>,
    pub broker_pubkey: String,
    pub attestation_sig: String,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub provider_status: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ComputeBondQuery {
    pub status: Option<String>,
    pub provider: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct TaskComputeBondPage {
    pub task_id: String,
    pub items: Vec<ComputeBondSummary>,
}

#[derive(Debug, Serialize)]
pub struct AgentComputeBondPage {
    pub agent_did: String,
    pub items: Vec<ComputeBondSummary>,
}

#[derive(Debug, Deserialize)]
pub struct SyncSnapshotsRequest {
    pub items: Vec<ComputeBondSummary>,
}

#[derive(Debug, Serialize)]
pub struct SyncSnapshotsResponse {
    pub upserted: usize,
}

#[derive(QueryableByName, Debug)]
struct RawComputeBondRow {
    #[diesel(sql_type = Text)]
    lease_id: String,
    #[diesel(sql_type = Text)]
    agent_did: String,
    #[diesel(sql_type = Text)]
    provider: String,
    #[diesel(sql_type = Integer)]
    gpu_hours: i32,
    #[diesel(sql_type = BigInt)]
    expires_at: i64,
    #[diesel(sql_type = BigInt)]
    slashable_until: i64,
    #[diesel(sql_type = Nullable<Text>)]
    task_id_hex: Option<String>,
    #[diesel(sql_type = Text)]
    status: String,
    #[diesel(sql_type = Nullable<Text>)]
    status_reason: Option<String>,
    #[diesel(sql_type = Nullable<BigInt>)]
    reserved_price_usd_micro: Option<i64>,
    #[diesel(sql_type = Text)]
    broker_pubkey: String,
    #[diesel(sql_type = Text)]
    attestation_sig: String,
    #[diesel(sql_type = BigInt)]
    created_at_ms: i64,
    #[diesel(sql_type = BigInt)]
    updated_at_ms: i64,
    #[diesel(sql_type = Nullable<Text>)]
    provider_status: Option<String>,
}

impl From<RawComputeBondRow> for ComputeBondSummary {
    fn from(row: RawComputeBondRow) -> Self {
        Self {
            lease_id: row.lease_id,
            agent_did: row.agent_did,
            provider: row.provider,
            gpu_hours: row.gpu_hours,
            expires_at: row.expires_at,
            slashable_until: row.slashable_until,
            task_id: row.task_id_hex,
            status: row.status,
            status_reason: row.status_reason,
            reserved_price_usd_micro: row.reserved_price_usd_micro,
            broker_pubkey: row.broker_pubkey,
            attestation_sig: row.attestation_sig,
            created_at_ms: row.created_at_ms,
            updated_at_ms: row.updated_at_ms,
            provider_status: row.provider_status,
        }
    }
}

pub fn public_router(state: ApiState) -> Router {
    Router::new()
        .route(
            "/v1/discovery/agents/:did/compute-bonds",
            get(agent_compute_bonds),
        )
        .route(
            "/v1/discovery/tasks/:task_id_hex/compute-bonds",
            get(task_compute_bonds),
        )
        .with_state(state)
}

pub fn internal_router() -> Router<InternalApiState> {
    Router::new().route("/compute-bonds/snapshots", post(sync_snapshots))
}

pub async fn load_task_bond_map(
    pool: PgPool,
    task_ids: Vec<String>,
) -> Result<HashMap<String, Vec<ComputeBondSummary>>, ApiError> {
    if task_ids.is_empty() {
        return Ok(HashMap::new());
    }
    for task_id in &task_ids {
        validate_task_id(task_id)?;
    }

    let rows = tokio::task::spawn_blocking(move || -> Result<Vec<RawComputeBondRow>, ApiError> {
        let mut conn = pool.get().map_err(ApiError::internal)?;
        sql_query(
            "SELECT lease_id, agent_did, provider, gpu_hours, expires_at, slashable_until,
                    task_id_hex, status, status_reason, reserved_price_usd_micro,
                    broker_pubkey, attestation_sig, created_at_ms, updated_at_ms, provider_status
             FROM compute_bond_snapshots
             WHERE task_id_hex = ANY($1)
             ORDER BY updated_at_ms DESC, lease_id ASC",
        )
        .bind::<Array<Text>, _>(task_ids)
        .load::<RawComputeBondRow>(&mut conn)
        .map_err(ApiError::internal)
    })
    .await
    .map_err(ApiError::internal)??;

    let mut grouped = HashMap::<String, Vec<ComputeBondSummary>>::new();
    for row in rows {
        let Some(task_id) = row.task_id_hex.clone() else {
            continue;
        };
        grouped.entry(task_id).or_default().push(row.into());
    }
    Ok(grouped)
}

async fn task_compute_bonds(
    State(state): State<ApiState>,
    Path(task_id_hex): Path<String>,
    Query(q): Query<ComputeBondQuery>,
) -> Result<Json<TaskComputeBondPage>, ApiError> {
    validate_task_id(&task_id_hex)?;
    let filters = parse_filters(q)?;
    let items = query_task_bonds(state.pool.clone(), task_id_hex.clone(), filters).await?;
    Ok(Json(TaskComputeBondPage {
        task_id: task_id_hex,
        items,
    }))
}

async fn agent_compute_bonds(
    State(state): State<ApiState>,
    Path(did_hex): Path<String>,
    Query(q): Query<ComputeBondQuery>,
) -> Result<Json<AgentComputeBondPage>, ApiError> {
    validate_task_id(&did_hex)?;
    let filters = parse_filters(q)?;
    let items = query_agent_bonds(state.pool.clone(), did_hex.clone(), filters).await?;
    Ok(Json(AgentComputeBondPage {
        agent_did: did_hex,
        items,
    }))
}

async fn sync_snapshots(
    State(state): State<InternalApiState>,
    headers: HeaderMap,
    Json(body): Json<SyncSnapshotsRequest>,
) -> Result<Json<SyncSnapshotsResponse>, ApiError> {
    authorize_request(&headers, state.token.as_deref())?;
    if body.items.is_empty() {
        return Err(ApiError::bad_request("items must not be empty"));
    }

    for item in &body.items {
        validate_snapshot(item)?;
    }

    let items = body.items;
    let pool = state.pool.clone();
    let upserted = tokio::task::spawn_blocking(move || -> Result<usize, ApiError> {
        let mut conn = pool.get().map_err(ApiError::internal)?;
        conn.transaction::<usize, diesel::result::Error, _>(|conn| {
            for item in &items {
                sql_query(
                    "INSERT INTO compute_bond_snapshots (
                        lease_id, agent_did, provider, gpu_hours, expires_at,
                        slashable_until, task_id_hex, status, status_reason,
                        reserved_price_usd_micro, broker_pubkey, attestation_sig,
                        created_at_ms, updated_at_ms, provider_status, synced_at
                     ) VALUES (
                        $1, $2, $3, $4, $5,
                        $6, $7, $8, $9,
                        $10, $11, $12,
                        $13, $14, $15, now()
                     )
                     ON CONFLICT (lease_id) DO UPDATE SET
                        agent_did = EXCLUDED.agent_did,
                        provider = EXCLUDED.provider,
                        gpu_hours = EXCLUDED.gpu_hours,
                        expires_at = EXCLUDED.expires_at,
                        slashable_until = EXCLUDED.slashable_until,
                        task_id_hex = EXCLUDED.task_id_hex,
                        status = EXCLUDED.status,
                        status_reason = EXCLUDED.status_reason,
                        reserved_price_usd_micro = EXCLUDED.reserved_price_usd_micro,
                        broker_pubkey = EXCLUDED.broker_pubkey,
                        attestation_sig = EXCLUDED.attestation_sig,
                        created_at_ms = EXCLUDED.created_at_ms,
                        updated_at_ms = EXCLUDED.updated_at_ms,
                        provider_status = EXCLUDED.provider_status,
                        synced_at = now()",
                )
                .bind::<Text, _>(&item.lease_id)
                .bind::<Text, _>(&item.agent_did)
                .bind::<Text, _>(&item.provider)
                .bind::<Integer, _>(item.gpu_hours)
                .bind::<BigInt, _>(item.expires_at)
                .bind::<BigInt, _>(item.slashable_until)
                .bind::<Nullable<Text>, _>(item.task_id.as_deref())
                .bind::<Text, _>(&item.status)
                .bind::<Nullable<Text>, _>(item.status_reason.as_deref())
                .bind::<Nullable<BigInt>, _>(item.reserved_price_usd_micro)
                .bind::<Text, _>(&item.broker_pubkey)
                .bind::<Text, _>(&item.attestation_sig)
                .bind::<BigInt, _>(item.created_at_ms)
                .bind::<BigInt, _>(item.updated_at_ms)
                .bind::<Nullable<Text>, _>(item.provider_status.as_deref())
                .execute(conn)?;
            }
            Ok(items.len())
        })
        .map_err(ApiError::internal)
    })
    .await
    .map_err(ApiError::internal)??;

    Ok(Json(SyncSnapshotsResponse { upserted }))
}

#[derive(Clone, Debug)]
struct BondFilters {
    status: Option<String>,
    provider: Option<String>,
    limit: i64,
}

fn parse_filters(q: ComputeBondQuery) -> Result<BondFilters, ApiError> {
    if let Some(status) = q.status.as_deref() {
        validate_status(status)?;
    }
    if let Some(provider) = q.provider.as_deref() {
        validate_provider(provider)?;
    }
    Ok(BondFilters {
        status: q.status,
        provider: q.provider,
        limit: q.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT),
    })
}

async fn query_task_bonds(
    pool: PgPool,
    task_id_hex: String,
    filters: BondFilters,
) -> Result<Vec<ComputeBondSummary>, ApiError> {
    let status = filters.status.clone();
    let provider = filters.provider.clone();
    let limit = filters.limit;
    let rows = tokio::task::spawn_blocking(move || -> Result<Vec<RawComputeBondRow>, ApiError> {
        let mut conn = pool.get().map_err(ApiError::internal)?;
        let mut sql = String::from(
            "SELECT lease_id, agent_did, provider, gpu_hours, expires_at, slashable_until,
                    task_id_hex, status, status_reason, reserved_price_usd_micro,
                    broker_pubkey, attestation_sig, created_at_ms, updated_at_ms, provider_status
             FROM compute_bond_snapshots
             WHERE task_id_hex = $1",
        );
        let mut next = 2;
        if status.is_some() {
            sql.push_str(&format!(" AND status = ${next}"));
            next += 1;
        }
        if provider.is_some() {
            sql.push_str(&format!(" AND provider = ${next}"));
            next += 1;
        }
        sql.push_str(&format!(
            " ORDER BY updated_at_ms DESC, lease_id ASC LIMIT ${next}"
        ));

        let mut qb = sql_query(sql).into_boxed::<diesel::pg::Pg>();
        qb = qb.bind::<Text, _>(task_id_hex);
        if let Some(status) = status {
            qb = qb.bind::<Text, _>(status);
        }
        if let Some(provider) = provider {
            qb = qb.bind::<Text, _>(provider);
        }
        qb.bind::<BigInt, _>(limit)
            .load::<RawComputeBondRow>(&mut conn)
            .map_err(ApiError::internal)
    })
    .await
    .map_err(ApiError::internal)??;

    Ok(rows.into_iter().map(Into::into).collect())
}

async fn query_agent_bonds(
    pool: PgPool,
    did_hex: String,
    filters: BondFilters,
) -> Result<Vec<ComputeBondSummary>, ApiError> {
    let did_bytes = hex::decode(&did_hex).map_err(|_| ApiError::bad_request("did must be hex"))?;
    let status = filters.status.clone();
    let provider = filters.provider.clone();
    let limit = filters.limit;

    let rows = tokio::task::spawn_blocking(move || -> Result<Vec<RawComputeBondRow>, ApiError> {
        let mut conn = pool.get().map_err(ApiError::internal)?;
        let task_rows: Vec<String> = sql_query(
            "SELECT encode(task_id, 'hex') AS task_id_hex
             FROM task_directory
             WHERE agent_did = $1
             ORDER BY COALESCE(updated_at_unix, created_at_unix) DESC, task_id ASC
             LIMIT 200",
        )
        .bind::<diesel::sql_types::Bytea, _>(did_bytes)
        .load::<HexTaskIdRow>(&mut conn)
        .map_err(ApiError::internal)?
        .into_iter()
        .map(|row| row.task_id_hex)
        .collect();
        if task_rows.is_empty() {
            return Ok(Vec::new());
        }

        let mut sql = String::from(
            "SELECT lease_id, agent_did, provider, gpu_hours, expires_at, slashable_until,
                    task_id_hex, status, status_reason, reserved_price_usd_micro,
                    broker_pubkey, attestation_sig, created_at_ms, updated_at_ms, provider_status
             FROM compute_bond_snapshots
             WHERE task_id_hex = ANY($1)",
        );
        let mut next = 2;
        if status.is_some() {
            sql.push_str(&format!(" AND status = ${next}"));
            next += 1;
        }
        if provider.is_some() {
            sql.push_str(&format!(" AND provider = ${next}"));
            next += 1;
        }
        sql.push_str(&format!(
            " ORDER BY updated_at_ms DESC, lease_id ASC LIMIT ${next}"
        ));

        let mut qb = sql_query(sql).into_boxed::<diesel::pg::Pg>();
        qb = qb.bind::<Array<Text>, _>(task_rows);
        if let Some(status) = status {
            qb = qb.bind::<Text, _>(status);
        }
        if let Some(provider) = provider {
            qb = qb.bind::<Text, _>(provider);
        }
        qb.bind::<BigInt, _>(limit)
            .load::<RawComputeBondRow>(&mut conn)
            .map_err(ApiError::internal)
    })
    .await
    .map_err(ApiError::internal)??;

    Ok(rows.into_iter().map(Into::into).collect())
}

fn authorize_request(headers: &HeaderMap, expected: Option<&str>) -> Result<(), ApiError> {
    let Some(expected) = expected else {
        return Ok(());
    };
    let provided = headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(str::trim);
    if provided == Some(expected) {
        Ok(())
    } else {
        Err(ApiError::bad_request("missing or invalid authorization"))
    }
}

fn validate_snapshot(item: &ComputeBondSummary) -> Result<(), ApiError> {
    if item.lease_id.trim().is_empty() {
        return Err(ApiError::bad_request("lease_id must not be empty"));
    }
    validate_provider(&item.provider)?;
    validate_status(&item.status)?;
    if let Some(task_id) = item.task_id.as_deref() {
        validate_task_id(task_id)?;
    }
    if item.created_at_ms <= 0 || item.updated_at_ms <= 0 {
        return Err(ApiError::bad_request(
            "created_at_ms and updated_at_ms must be positive",
        ));
    }
    if item.gpu_hours <= 0 {
        return Err(ApiError::bad_request("gpu_hours must be positive"));
    }
    Ok(())
}

fn validate_status(status: &str) -> Result<(), ApiError> {
    if BOND_STATUSES.contains(&status) {
        Ok(())
    } else {
        Err(ApiError::bad_request(
            "status must be reserved|locked|released|slashed|cancelled|expired",
        ))
    }
}

fn validate_provider(provider: &str) -> Result<(), ApiError> {
    if BOND_PROVIDERS.contains(&provider) {
        Ok(())
    } else {
        Err(ApiError::bad_request("provider must be ionet|akash"))
    }
}

fn validate_task_id(task_id: &str) -> Result<(), ApiError> {
    let bytes = hex::decode(task_id).map_err(|_| ApiError::bad_request("id must be hex"))?;
    if bytes.len() == 32 {
        Ok(())
    } else {
        Err(ApiError::bad_request("id must be 32 bytes"))
    }
}

#[derive(QueryableByName)]
struct HexTaskIdRow {
    #[diesel(sql_type = Text)]
    task_id_hex: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filters_validate_whitelists() {
        assert!(parse_filters(ComputeBondQuery {
            status: Some("locked".into()),
            provider: Some("akash".into()),
            limit: Some(10),
        })
        .is_ok());
        assert!(parse_filters(ComputeBondQuery {
            status: Some("bogus".into()),
            provider: None,
            limit: None,
        })
        .is_err());
        assert!(parse_filters(ComputeBondQuery {
            status: None,
            provider: Some("bogus".into()),
            limit: None,
        })
        .is_err());
    }

    #[test]
    fn snapshot_validation_rejects_bad_ids() {
        let bad = ComputeBondSummary {
            lease_id: "lease".into(),
            agent_did: "agent".into(),
            provider: "ionet".into(),
            gpu_hours: 1,
            expires_at: 1,
            slashable_until: 2,
            task_id: Some("deadbeef".into()),
            status: "reserved".into(),
            status_reason: None,
            reserved_price_usd_micro: None,
            broker_pubkey: "broker".into(),
            attestation_sig: "sig".into(),
            created_at_ms: 1,
            updated_at_ms: 1,
            provider_status: None,
        };
        assert!(validate_snapshot(&bad).is_err());
    }

    #[test]
    fn auth_allows_missing_token_when_unconfigured() {
        let headers = HeaderMap::new();
        assert!(authorize_request(&headers, None).is_ok());
    }

    #[test]
    fn auth_requires_matching_bearer_token() {
        let mut headers = HeaderMap::new();
        headers.insert("authorization", "Bearer shh".parse().unwrap());
        assert!(authorize_request(&headers, Some("shh")).is_ok());
        assert!(authorize_request(&headers, Some("nope")).is_err());
    }
}
