use anyhow::{Context, Result};
use std::collections::HashMap;
use tokio_stream::StreamExt;

use yellowstone_grpc_client::{ClientTlsConfig, GeyserGrpcClient};
use yellowstone_grpc_proto::geyser::{
    subscribe_update::UpdateOneof, CommitmentLevel, SubscribeRequest,
    SubscribeRequestFilterBlocksMeta, SubscribeRequestFilterTransactions,
};

use crate::config::Config;
use crate::db::PgPool;
use crate::idl::{self, Registry};
use crate::programs;

pub async fn run(cfg: Config, _pool: PgPool) -> Result<()> {
    let idl_dir = idl::default_idl_path();
    let registry = Registry::load_from_dir(&idl_dir)
        .with_context(|| format!("loading anchor IDLs from {}", idl_dir.display()))?;
    tracing::info!(
        idl_dir = %idl_dir.display(),
        programs = registry.programs_loaded().len(),
        events = registry.event_count(),
        "idl event registry loaded"
    );


    let mut client = GeyserGrpcClient::build_from_shared(cfg.yellowstone_endpoint.clone())?
        .x_token(cfg.yellowstone_x_token.clone())?
        .tls_config(ClientTlsConfig::new().with_native_roots())?
        .connect()
        .await
        .context("yellowstone connect")?;

    let req = build_request();
    let (_tx, mut stream) = client.subscribe_with_request(Some(req)).await?;

    tracing::info!(
        programs = programs::SAEP_PROGRAMS.len(),
        "subscribed to yellowstone"
    );

    while let Some(msg) = stream.next().await {
        match msg {
            Ok(update) => match update.update_oneof {
                Some(UpdateOneof::BlockMeta(_meta)) => {
                    // REORG-LOGIC-STUB: feed meta.slot + meta.blockhash into reorg::detect_reorg
                }
                Some(UpdateOneof::Transaction(_tx)) => {
                    // Iteration over tx.transaction.meta.inner_instructions to pull out
                    // CPI payloads targeting __event_authority lives here. For every such
                    // inner instruction we call `ingest::decode_event(&registry, program_id, data)`
                    // and, on Some, insert via `ingest::record_event`.
                    //
                    // The proto plumbing (mapping account indices → program ids, base58
                    // encoding signatures, deriving slot) is mechanical and gated by
                    // Helius access for a smoke run — not wired in this cycle.
                    let _ = &registry;
                }
                Some(UpdateOneof::Ping(_)) => {}
                _ => {}
            },
            Err(e) => {
                tracing::error!(error = %e, "stream error; reconnect loop goes here");
                break;
            }
        }
    }

    Ok(())
}

fn build_request() -> SubscribeRequest {
    let ids = programs::all_ids();

    let mut transactions = HashMap::new();
    transactions.insert(
        "saep".to_string(),
        SubscribeRequestFilterTransactions {
            vote: Some(false),
            failed: Some(false),
            signature: None,
            account_include: ids,
            account_exclude: vec![],
            account_required: vec![],
        },
    );

    let mut blocks_meta = HashMap::new();
    blocks_meta.insert("meta".to_string(), SubscribeRequestFilterBlocksMeta {});

    SubscribeRequest {
        accounts: HashMap::new(),
        slots: HashMap::new(),
        transactions,
        transactions_status: HashMap::new(),
        blocks: HashMap::new(),
        blocks_meta,
        entry: HashMap::new(),
        commitment: Some(CommitmentLevel::Confirmed as i32),
        accounts_data_slice: vec![],
        ping: None,
        from_slot: None,
    }
}
