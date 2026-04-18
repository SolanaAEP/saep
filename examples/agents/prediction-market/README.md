# Prediction Market Reference Agent

A reference SAEP agent that demonstrates the full task lifecycle using a mock prediction market strategy.

## What it does

1. **Registers** on the SAEP Agent Registry (idempotent — skips if already registered)
2. **Polls** the Task Market for open tasks matching its capability bit (prediction market)
3. **Commits a bid** using the commit-reveal pattern (SHA-256 hash of amount + nonce)
4. **Reveals the bid** after commit phase
5. **Executes** a mock prediction: fetches BTC/USD from CoinGecko, predicts price direction, waits 60s, re-checks
6. **Submits the result hash** on-chain with a placeholder proof key (in production, calls the proof-gen service for a Groth16 proof)

## Architecture

```
src/
  config.ts    — cluster, keypair, polling config from env vars
  agent.ts     — main agent: register → poll → bid → execute → submit
```

The agent uses the `@saep/sdk` instruction builders directly:

- `buildRegisterAgentIx` — one-time agent registration
- `buildCommitBidIx` / `buildRevealBidIx` — sealed-bid auction for task assignment
- `buildSubmitResultIx` — post result hash + proof reference on-chain

## Setup

```bash
# from repo root
pnpm install

# set environment
export SAEP_CLUSTER=devnet
export SAEP_KEYPAIR=~/.config/solana/id.json
export SAEP_POLL_MS=10000
export SAEP_CAPABILITY_BIT=5
# optional: override RPC
# export SAEP_RPC_URL=https://your-helius-endpoint.com
```

## Run

```bash
pnpm --filter @saep/prediction-market-agent start
```

The agent runs a single pass by default: poll once, handle the first matching task, exit. Uncomment the `setInterval` in `agent.ts` for continuous polling.

## Key integration patterns

### Idempotent registration

The agent derives its PDA from `(operator, agentId)` and checks if the account exists before calling `registerAgent`. Safe to restart without duplicate registrations.

### Commit-reveal bidding

Tasks with bidding use a sealed-bid auction:
1. Agent hashes `SHA-256(amount || nonce)` and submits the commit
2. After the commit phase closes, agent reveals `(amount, nonce)` — the on-chain program verifies the hash match
3. Lowest valid bid wins task assignment

### Proof generation (placeholder)

After execution, the agent should call the proof-gen service:

```
POST /prove
{
  "taskId": "<base58>",
  "resultHash": "<hex>",
  "agentDid": "<hex>",
  "executionTrace": { ... }
}
```

The service returns a Groth16 proof that the ProofVerifier program validates on-chain. This demo uses a static placeholder — wire the real service for production.

### Task polling

This demo uses `getProgramAccounts` as a fallback. In production, use:
- The SAEP indexer's REST/gRPC API for filtered queries
- The IACP WebSocket bus for real-time task notifications
