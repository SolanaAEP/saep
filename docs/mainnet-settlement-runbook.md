# Mainnet Settlement Runbook

SAEP mainnet task settlement stays wallet-signed end to end. The portal may proxy proof-gen jobs, but it never receives wallet keys and never signs task-market writes.

## Readiness Gate

Before enabling mainnet verify or release actions, confirm the portal settlement panel reports readiness for:

- `MarketGlobal` exists and is not paused.
- `proof_verifier` mode is mainnet.
- Verifier config exists and is not paused.
- Active verifier key matches `task_completion.v1`.
- Active verifier key is marked production.
- `task_market` is present in `proof_verifier` allowed callers.
- Proof-gen `/healthz` reports loaded artifacts and a present verification key.
- Proof-gen `/circuits` exposes live `task_completion.v1` with the expected public inputs.

If any check fails, mainnet settlement remains disabled. Do not fall back to dev-only verifier keys or test proofs on mainnet.

The same gate is available as a read-only smoke:

```bash
NEXT_PUBLIC_SOLANA_CLUSTER=mainnet-beta \
NEXT_PUBLIC_RPC_URL=https://mainnet.helius-rpc.com/?api-key=<helius-key> \
PROOFGEN_API_URL=https://<proof-gen-render-service>.onrender.com \
pnpm smoke:mainnet-settlement-readiness
```

## Agent Operator Flow

1. Open the funded task detail page at `/tasks/:id`.
2. Connect the wallet that controls the assigned active agent operator account.
3. Sign in with wallet if proof-gen job creation requires a portal session.
4. Paste or upload the v1 task-completion witness JSON.
5. Submit the result hash with the connected wallet.
6. Generate the proof once the refreshed task account has `proofSubmitted` status and a nonzero `submittedAt`.
7. Verify the task with the wallet-signed `verify_task` transaction.
8. Wait for the dispute-window countdown to close.
9. Release escrow with the wallet-signed release transaction.

The release builder includes idempotent associated-token-account creation for the agent payout account, protocol fee account, and solrep pool account.

## Recovery

- If the proof-gen job fails, keep the task in `proofSubmitted`, fix the witness or hosted artifact blocker, and create a new proof job.
- If `verify_task` fails simulation, check the readiness gate first, then compare public inputs against the task account.
- If release reports the dispute window is still open, wait for cluster time to pass `disputeWindowEnd` and retry.
- If the indexer lags, use the task detail page account read as the source of truth and wait for `/tasks` to refresh.

Manual canaries remain tiny: one `1 USDC` task and one `100 SAEP` task from a public agent operator wallet.
