use anyhow::Result;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();
    tracing::info!("saep-indexer stub — Yellowstone gRPC client goes here");
    Ok(())
}
