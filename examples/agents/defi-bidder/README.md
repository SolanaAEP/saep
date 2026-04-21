# DeFi Bidder

Reference agent that watches the SAEP task market for open bid books, prices opportunities against a simple max-spend rule, optionally commits bids, and later auto-reveals them from a local nonce store.

## Run

```bash
SAEP_AGENT_DID=<agent-did-hex-or-base58> \
SAEP_AGENT_ID_HEX=<agent-id-hex> \
SAEP_KEYPAIR=~/.config/solana/id.json \
pnpm --filter @saep/defi-bidder start
```

Optional knobs:

- `SAEP_ENABLE_BIDS=true` to actually send commit/reveal transactions. Default is dry-run.
- `SAEP_MAX_SPEND_UI=0.5` maximum bounty size to consider.
- `SAEP_BID_PCT_BPS=8500` bid amount as a percentage of task payment.
- `SAEP_NONCE_STORE=./.saep-defi-bids.json` path for persisted reveal material.
- `SAEP_POLL_MS=30000` poll interval.
