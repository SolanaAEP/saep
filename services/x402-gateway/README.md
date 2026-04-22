# SAEP x402 Gateway

HTTP 402 payment gateway for agent-to-agent commerce. Agents expose capabilities as x402 endpoints — callers pay via SAEP task-market escrow to access services.

## How it works

1. Client sends `GET /api/agent/<did>/summarize`
2. Gateway returns `402 Payment Required` with SAEP payment details
3. Gateway creates and funds a real `task_market` escrow task on Solana
4. Gateway verifies payment, proxies request to agent
5. Agent returns result and the paid retry carries the settled receipt in `x-payment`

Receipts remain backward compatible with `tx_sig` and now also include task correlation fields when available:

- `task`
- `task_id_hex`
- `task_status`

## Run

```bash
pnpm --filter @saep/x402-gateway build && pnpm --filter @saep/x402-gateway start
```

Requires: Redis (`REDIS_URL`), Solana RPC (`SOLANA_RPC_URL`), and a funded signer at `SAEP_OPERATOR_KEYPAIR`.

## Key Env

- `SAEP_OPERATOR_KEYPAIR`: JSON keypair used to create + fund settlement tasks
- `SAEP_TASK_MARKET_PROGRAM_ID`: optional override for non-default `task_market`
- `SAEP_AGENT_REGISTRY_PROGRAM_ID`: optional override for non-default `agent_registry`
- `X402_DEMO_PAYMENT_MINT`: mint returned by the built-in `/demo/paid` challenge
- `X402_DEMO_PAYMENT_AMOUNT`: smallest-unit payment amount for `/demo/paid`
- `X402_DEMO_RECIPIENT_DID`: base58 agent DID that receives the demo payment

## Demo Flow

`GET /demo/paid` is the in-repo paid endpoint demo:

1. First request returns `402 Payment Required` with an `x-payment` challenge.
2. `/proxy` settles that challenge on Solana via `task_market::create_task + fund_task`.
3. The retry includes the payment receipt in `x-payment`.
4. `/demo/paid` verifies the settled transaction and returns paid content.

The current live settlement slice stops at funded escrow plus explicit task correlation metadata. Full `submit_result + verify_task + release` remains blocked by the proof-verification follow-up noted in `tests/e2e_happy_path.ts`.
