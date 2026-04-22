# SAEP XRPL Bridge

Prototype cross-chain settlement service for routing XRPL and selected Wormhole-originated payments
into Solana-side SAEP task settlement.

## Status

Prototype. The bridge now returns normalized workflow metadata with each settlement so future
portal and indexer surfaces can treat cross-chain jobs as one intent lifecycle instead of parsing
bridge-specific status blobs.

## HTTP surface

- `POST /bridge/xrpl` — accept XRPL payment metadata and create a Solana-side settlement flow
- `POST /bridge/wormhole` — process a supported Wormhole transfer payload into settlement
- `GET /bridge/status/:txHash` — fetch stored settlement status plus normalized intent metadata
- `GET /metrics`
- `GET /health`
