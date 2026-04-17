use std::collections::{HashMap, HashSet};
use std::time::Duration;

use anyhow::{Context, Result};
use chrono::Utc;
use futures::StreamExt;
use yellowstone_grpc_client::GeyserGrpcClient;
use yellowstone_grpc_proto::geyser::{
    CommitmentLevel, SubscribeRequest, SubscribeRequestFilterAccounts,
    SubscribeRequestFilterSlots, SubscribeUpdate,
    subscribe_update::UpdateOneof,
};

use crate::config::Config;
use crate::db::PgPool;
use crate::idl::Registry;
use crate::ingest::{self, NewEvent};
use crate::metrics;
use crate::programs::{SaepProgram, SAEP_PROGRAMS};
use crate::pubsub::Publisher;

const RECONNECT_DELAY: Duration = Duration::from_secs(3);
const MAX_RECONNECT_DELAY: Duration = Duration::from_secs(60);

pub async fn run(cfg: Config, pool: PgPool, publisher: Publisher) -> Result<()> {
    let idl_dir = crate::idl::default_idl_path();
    let registry = crate::idl::Registry::load_from_dir(&idl_dir)
        .with_context(|| format!("loading anchor IDLs from {}", idl_dir.display()))?;
    tracing::info!(
        idl_dir = %idl_dir.display(),
        programs = registry.programs_loaded().len(),
        events = registry.event_count(),
        "idl registry loaded"
    );

    let endpoint = cfg
        .yellowstone_endpoint
        .clone()
        .expect("YELLOWSTONE_ENDPOINT required for gRPC mode");

    let mut backoff = RECONNECT_DELAY;

    loop {
        match stream_once(&endpoint, &cfg, &pool, &registry, &publisher).await {
            Ok(()) => {
                tracing::warn!("gRPC stream ended cleanly; reconnecting");
                backoff = RECONNECT_DELAY;
            }
            Err(e) => {
                tracing::error!(error = %e, "gRPC stream error; reconnecting in {:?}", backoff);
                metrics::RPC_ERRORS.with_label_values(&["grpc_stream"]).inc();
                tokio::time::sleep(backoff).await;
                backoff = (backoff * 2).min(MAX_RECONNECT_DELAY);
            }
        }
    }
}

async fn stream_once(
    endpoint: &str,
    cfg: &Config,
    pool: &PgPool,
    registry: &Registry,
    publisher: &Publisher,
) -> Result<()> {
    let mut client = GeyserGrpcClient::build_from_shared(endpoint.to_string())?
        .x_token(cfg.yellowstone_token.clone())?
        .connect()
        .await
        .context("gRPC connect")?;

    let program_ids: Vec<String> = SAEP_PROGRAMS.iter().map(|p| p.id.to_string()).collect();

    let accounts: HashMap<String, SubscribeRequestFilterAccounts> = [(
        "saep_accounts".to_string(),
        SubscribeRequestFilterAccounts {
            account: vec![],
            owner: program_ids,
            filters: vec![],
            nonempty_txn_signature: Some(true),
        },
    )]
    .into();

    let slots: HashMap<String, SubscribeRequestFilterSlots> = [(
        "slot_updates".to_string(),
        SubscribeRequestFilterSlots {
            filter_by_commitment: Some(true),
            interslot_updates: Some(false),
        },
    )]
    .into();

    let request = SubscribeRequest {
        accounts,
        slots,
        commitment: Some(CommitmentLevel::Confirmed.into()),
        ..Default::default()
    };

    let (_subscribe_tx, mut stream) = client
        .subscribe_with_request(Some(request))
        .await
        .context("gRPC subscribe")?;

    tracing::info!("yellowstone gRPC stream connected");

    let mut seen_slots: SlotDedup = SlotDedup::new();

    while let Some(msg) = stream.next().await {
        let msg: SubscribeUpdate = msg.context("gRPC stream recv")?;

        let update = match msg.update_oneof {
            Some(u) => u,
            None => continue,
        };

        match update {
            UpdateOneof::Slot(slot_update) => {
                seen_slots.observe_slot(slot_update.slot);
            }
            UpdateOneof::Account(account_update) => {
                let account = match account_update.account {
                    Some(a) => a,
                    None => continue,
                };

                let slot = account_update.slot as i64;
                let txn_signature = match &account.txn_signature {
                    Some(sig) if !sig.is_empty() => bs58::encode(sig).into_string(),
                    _ => continue,
                };

                if seen_slots.is_duplicate(slot, &txn_signature) {
                    continue;
                }
                seen_slots.mark_seen(slot, &txn_signature);

                let owner = bs58::encode(&account.owner).into_string();

                let program = match find_program(&owner) {
                    Some(p) => p,
                    None => continue,
                };

                let data = &account.data;
                if data.len() < 8 {
                    continue;
                }

                if let Some((event_name, decoded)) = ingest::decode_event(registry, program.id, data) {
                    let ev = NewEvent {
                        signature: &txn_signature,
                        slot,
                        program_id: program.id,
                        event_name: &event_name,
                        data: decoded.clone(),
                        ingested_at: Utc::now(),
                    };

                    if let Err(e) = ingest::record_event(pool, ev) {
                        tracing::warn!(error = %e, signature = %txn_signature, "record_event failed");
                    } else {
                        metrics::EVENTS_INGESTED
                            .with_label_values(&[program.name, &event_name])
                            .inc();
                        metrics::LAST_SLOT
                            .with_label_values(&[program.name])
                            .set(slot);

                        let lag = (Utc::now().timestamp() - (slot / 2)) as f64;
                        metrics::INGEST_LAG
                            .with_label_values(&[program.name])
                            .observe(lag.max(0.0));

                        publisher.spawn_publish(
                            program.name,
                            program.id,
                            &event_name,
                            &txn_signature,
                            slot,
                            &decoded,
                        );
                    }
                }

                write_cursor_for_stream(pool, program.id, &txn_signature, slot);
            }
            UpdateOneof::Ping(_) => {}
            UpdateOneof::Pong(_) => {}
            _ => {}
        }
    }

    Ok(())
}

fn find_program(owner: &str) -> Option<&'static SaepProgram> {
    SAEP_PROGRAMS.iter().find(|p| p.id == owner)
}

fn write_cursor_for_stream(pool: &PgPool, program_id: &str, sig: &str, slot: i64) {
    use crate::schema::sync_cursor;
    use diesel::prelude::*;

    let conn = match pool.get() {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!(error = %e, "cursor update pool.get failed");
            return;
        }
    };
    let mut conn = conn;

    if let Err(e) = diesel::insert_into(sync_cursor::table)
        .values((
            sync_cursor::program_id.eq(program_id),
            sync_cursor::last_sig.eq(sig),
            sync_cursor::last_slot.eq(slot),
            sync_cursor::updated_at.eq(Utc::now()),
        ))
        .on_conflict(sync_cursor::program_id)
        .do_update()
        .set((
            sync_cursor::last_sig.eq(sig),
            sync_cursor::last_slot.eq(slot),
            sync_cursor::updated_at.eq(Utc::now()),
        ))
        .execute(&mut conn)
    {
        tracing::warn!(error = %e, program_id, "cursor write failed");
    }
}

struct SlotDedup {
    seen: HashMap<i64, HashSet<String>>,
    latest_slot: u64,
}

impl SlotDedup {
    fn new() -> Self {
        Self {
            seen: HashMap::new(),
            latest_slot: 0,
        }
    }

    fn observe_slot(&mut self, slot: u64) {
        if slot > self.latest_slot {
            self.latest_slot = slot;
            self.gc();
        }
    }

    fn is_duplicate(&self, slot: i64, signature: &str) -> bool {
        self.seen
            .get(&slot)
            .map(|s| s.contains(signature))
            .unwrap_or(false)
    }

    fn mark_seen(&mut self, slot: i64, signature: &str) {
        self.seen
            .entry(slot)
            .or_default()
            .insert(signature.to_string());
    }

    fn gc(&mut self) {
        let cutoff = self.latest_slot.saturating_sub(200) as i64;
        self.seen.retain(|&slot, _| slot >= cutoff);
    }
}
