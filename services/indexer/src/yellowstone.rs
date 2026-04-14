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
use crate::programs;

pub async fn run(cfg: Config, _pool: PgPool) -> Result<()> {
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
                    // EVENT-DECODE-STUB: parse tx.meta.log_messages / inner_instructions
                    // for the 8-byte Anchor event discriminator, route through ingest::decode_event
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
