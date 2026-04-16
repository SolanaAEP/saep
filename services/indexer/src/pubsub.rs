use anyhow::{Context, Result};
use chrono::Utc;
use redis::{aio::ConnectionManager, AsyncCommands};
use serde_json::{json, Value};

use crate::metrics;

/// Fans out decoded events to Redis Pub/Sub channels for realtime consumers
/// (portal WS subscriptions, IACP bus). No-op when `REDIS_URL` is unset or
/// the initial connection fails — ingest never blocks on Redis.
#[derive(Clone)]
pub struct Publisher {
    inner: Option<ConnectionManager>,
}

impl Publisher {
    pub async fn from_env(redis_url: Option<&str>) -> Self {
        let Some(url) = redis_url else {
            tracing::info!("REDIS_URL not set — event fanout disabled");
            return Self { inner: None };
        };
        match connect(url).await {
            Ok(cm) => {
                tracing::info!("redis pubsub connected");
                Self { inner: Some(cm) }
            }
            Err(e) => {
                tracing::warn!(error = %e, "redis pubsub connect failed — fanout disabled");
                Self { inner: None }
            }
        }
    }

    pub fn enabled(&self) -> bool {
        self.inner.is_some()
    }

    /// Fire-and-forget publish. Clones the connection manager (cheap — shares
    /// one multiplexed connection internally) and spawns the network write so
    /// the caller returns immediately.
    pub fn spawn_publish(
        &self,
        program: &'static str,
        program_id: &str,
        event_name: &str,
        signature: &str,
        slot: i64,
        data: &Value,
    ) {
        let Some(conn) = self.inner.clone() else {
            return;
        };
        let payload = build_payload(program_id, event_name, signature, slot, data);
        let per_program_channel = format!("saep:events:{program}");
        let all_channel = "saep:events:all".to_string();
        tokio::spawn(async move {
            let mut conn = conn;
            match conn
                .publish::<_, _, i64>(&per_program_channel, &payload)
                .await
            {
                Ok(_) => {
                    metrics::PUBSUB_PUBLISHES
                        .with_label_values(&[program, "ok"])
                        .inc();
                }
                Err(e) => {
                    tracing::warn!(
                        program,
                        channel = %per_program_channel,
                        error = %e,
                        "redis publish failed"
                    );
                    metrics::PUBSUB_PUBLISHES
                        .with_label_values(&[program, "err"])
                        .inc();
                    return;
                }
            }
            if let Err(e) = conn.publish::<_, _, i64>(&all_channel, &payload).await {
                tracing::warn!(
                    program,
                    channel = %all_channel,
                    error = %e,
                    "redis publish failed"
                );
                metrics::PUBSUB_PUBLISHES
                    .with_label_values(&[program, "err"])
                    .inc();
            } else {
                metrics::PUBSUB_PUBLISHES
                    .with_label_values(&[program, "ok"])
                    .inc();
            }
        });
    }
}

async fn connect(url: &str) -> Result<ConnectionManager> {
    let client = redis::Client::open(url).context("redis::Client::open")?;
    ConnectionManager::new(client)
        .await
        .context("ConnectionManager::new")
}

pub fn build_payload(
    program_id: &str,
    event_name: &str,
    signature: &str,
    slot: i64,
    data: &Value,
) -> String {
    json!({
        "program_id": program_id,
        "event": event_name,
        "signature": signature,
        "slot": slot,
        "data": data,
        "published_at": Utc::now().to_rfc3339(),
    })
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payload_includes_expected_fields() {
        let data = json!({ "amount": "1000", "did": [1, 2, 3] });
        let s = build_payload(
            "AgReg11111111111111111111111111111111111111",
            "AgentRegistered",
            "5xYz",
            12345,
            &data,
        );
        let v: Value = serde_json::from_str(&s).unwrap();
        assert_eq!(
            v["program_id"],
            "AgReg11111111111111111111111111111111111111"
        );
        assert_eq!(v["event"], "AgentRegistered");
        assert_eq!(v["signature"], "5xYz");
        assert_eq!(v["slot"], 12345);
        assert_eq!(v["data"]["amount"], "1000");
        assert!(v["published_at"].is_string());
    }

    #[tokio::test]
    async fn no_env_disables_publisher() {
        let p = Publisher::from_env(None).await;
        assert!(!p.enabled());
        p.spawn_publish(
            "agent_registry",
            "pid",
            "ev",
            "sig",
            1,
            &json!({}),
        );
    }
}
