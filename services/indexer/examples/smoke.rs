// Live-probe the Helius RPC pipeline without a database.
// Fetches signatures for the system program (guaranteed activity) then
// walks the first tx through inner-instructions exactly like the poller does,
// but prints counts instead of inserting.

use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use std::time::Duration;

#[tokio::main]
async fn main() -> Result<()> {
    let key = std::env::var("HELIUS_API_KEY_SAEP")
        .or_else(|_| std::env::var("HELIUS_API_KEY"))
        .map_err(|_| anyhow!("set HELIUS_API_KEY_SAEP"))?;
    let cluster = std::env::var("SOLANA_CLUSTER").unwrap_or_else(|_| "devnet".into());
    let host = match cluster.as_str() {
        "mainnet" | "mainnet-beta" => "mainnet.helius-rpc.com",
        _ => "devnet.helius-rpc.com",
    };
    let url = format!("https://{host}/?api-key={key}");
    let program = std::env::var("PROGRAM").unwrap_or_else(|_| {
        "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA".to_string()
    });

    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()?;

    println!("cluster={cluster} program={program}");

    let body = json!({
        "jsonrpc": "2.0", "id": 1,
        "method": "getSignaturesForAddress",
        "params": [program, { "limit": 5, "commitment": "confirmed" }],
    });
    let v: Value = http.post(&url).json(&body).send().await?.json().await?;
    let sigs = v
        .get("result")
        .and_then(|r| r.as_array())
        .cloned()
        .unwrap_or_default();
    println!("signatures returned: {}", sigs.len());
    if sigs.is_empty() {
        return Ok(());
    }

    let sig = sigs[0]
        .get("signature")
        .and_then(|s| s.as_str())
        .ok_or_else(|| anyhow!("sig missing"))?;
    let slot = sigs[0].get("slot").and_then(|s| s.as_i64()).unwrap_or(0);
    println!("first sig={sig} slot={slot}");

    let body = json!({
        "jsonrpc": "2.0", "id": 1,
        "method": "getTransaction",
        "params": [sig, { "commitment": "confirmed", "encoding": "json", "maxSupportedTransactionVersion": 0 }],
    });
    let v: Value = http.post(&url).json(&body).send().await?.json().await?;
    let tx = v.get("result").cloned().unwrap_or(Value::Null);
    let inner_count = tx
        .pointer("/meta/innerInstructions")
        .and_then(|a| a.as_array())
        .map(|a| a.len())
        .unwrap_or(0);
    let keys = tx
        .pointer("/transaction/message/accountKeys")
        .and_then(|a| a.as_array())
        .map(|a| a.len())
        .unwrap_or(0);
    println!("tx inner_instruction_groups={inner_count} accountKeys={keys}");
    println!("OK");
    Ok(())
}
