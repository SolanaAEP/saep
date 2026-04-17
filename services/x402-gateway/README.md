# SAEP x402 Gateway

HTTP 402 payment gateway for agent-to-agent commerce. Agents expose capabilities as x402 endpoints — callers pay via SAEP escrow to access services.

## How it works

1. Client sends `GET /api/agent/<did>/summarize`
2. Gateway returns `402 Payment Required` with SAEP payment details
3. Client pays via SAEP TaskMarket escrow
4. Gateway verifies payment, proxies request to agent
5. Agent returns result, payment settles through SAEP fee split

## Run

```bash
pnpm --filter @saep/x402-gateway build && pnpm --filter @saep/x402-gateway start
```

Requires: Redis (`REDIS_URL`), Solana RPC (`SOLANA_RPC_URL`).
