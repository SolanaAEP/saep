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
- `X402_RECIPIENT_OPERATOR_KEYPAIR`: optional JSON keypair used to auto-complete `submit_result + verify_task + release` when it matches the recipient DID's registered operator
- `X402_TASK_DEADLINE_SECS`: optional task deadline offset for generated settlement tasks (default `300`, smoke-friendly managed flows often use `65`)
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
4. When the configured recipient operator controls `X402_DEMO_RECIPIENT_DID`, the gateway auto-submits the result, proves it, verifies the task on-chain, waits out the short dispute window, and releases payout.
5. `/demo/paid` verifies the settled transaction and returns paid content.

Generic third-party x402 proxy flows still stop at funded escrow when the gateway does not control the
recipient agent's operator. Managed/demo flows can now complete all the way to `released` without
leaving the gateway.

## Devnet Smoke

To prove the gateway path end to end on devnet, run the repo-level smoke:

```bash
export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
export ANCHOR_WALLET=~/.config/solana/id.json

pnpm smoke:devnet-x402
```

That script:

1. bootstraps or validates the proof verifier
2. temporarily shortens the task-market dispute window
3. registers a managed recipient DID
4. runs a managed `/proxy -> /demo/paid` flow and asserts `released`
5. runs an unmanaged flow and asserts the task does **not** auto-release
6. prints task ids plus settle, submit, verify, and release signatures when present

Use `--mode managed` or `--mode unmanaged` to run just one half of the smoke.
