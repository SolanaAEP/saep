# Devnet Rehearsal Runbook

A step-by-step procedure for taking the QVAC local agent end-to-end on Solana devnet: register an agent, post a task, run the agent, watch it bid → execute → settle with a real Groth16 proof. This is the demo path for the Tether × Colosseum hackathon submission.

Most of these steps can be parallelised; the order below is the simplest single-operator path.

## Prerequisites

- Solana devnet keypair with at least 2 SOL for fees + stake (`solana airdrop 2 --url devnet`)
- `@saep/sdk` workspace built (`pnpm install` at repo root)
- `circuits/task_completion/build/` populated:
  ```
  cd circuits/task_completion
  bash scripts/compile.sh
  bash scripts/setup.sh
  ```
- `~/.qvac/models/` will get ~1.1GB of GGUFs on first run (Llama-3.2-1B + EmbeddingGemma).

## 1. Register the agent on devnet

Two ways:

**Option A — portal:** open https://buildonsaep.com (or `pnpm --filter @saep/portal dev`), connect the keypair, go to `/agents/register`, fill in capability mask, manifest URI, etc. The portal returns an agent DID hex on success.

**Option B — CLI:** see `scripts/register_agent_devnet.ts` (TODO in this repo) or call `buildRegisterAgentIx` directly from `@saep/sdk`.

Capture:
- `SAEP_AGENT_DID` (32-byte hex of the agent's DID)
- The agent's operator pubkey must equal the keypair the agent is run with.

## 2. Post a funded test task

You need a client-side flow that creates a task with a brief whose Poseidon2 hash matches what the agent will reconstruct. For the rehearsal, we use the **same operator** as both client and agent so we control both halves of the hash.

Steps:
1. Pick one of the briefs from `briefs/*.md` as the task content.
2. Compute `task_hash`, `criteria_root`, `salt` via the same Poseidon2 sponge the circuit uses (`scripts/gen_sample.mjs` is the reference).
3. Build a `task_market.create_task` ix with that `task_hash` and your chosen deadline.
4. Fund it via `task_market.fund_task` so it transitions to `funded`.

(There's no shipped CLI for this yet — see `apps/portal/src/app/(app)/marketplace/...` for the in-portal flow. For the rehearsal you can also use Quick Hire on the live portal pointed at devnet.)

Capture:
- `<task_id_hex>` for monitoring.

## 3. Resolve the active verifier key

Before running the agent, look up the on-chain `verifier_config` to get the `vkId`:

```
import { fetchVerifierConfig, fetchVerifierKey } from '@saep/sdk';
// ... vkId = activeKey.vkId
```

Set `SAEP_VK_ID=<32-byte hex>` so the agent can include it on `verify_task`. (The agent currently writes `paddedCircuitLabel('task_completion_v1')` as the proof_key into `submit_result`, but `verify_task` needs the real vkId — see `BLOCKERS.md` #2.)

## 4. Run the agent

```bash
SAEP_AGENT_DID=<did_hex> \
SAEP_KEYPAIR=~/.config/solana/id.json \
SAEP_CLUSTER=devnet \
SAEP_ENABLE_BIDS=true \
SAEP_ENABLE_SUBMIT=true \
pnpm --filter @saep/qvac-local-agent start
```

Expected log sequence (best-case lifecycle):

```
[qvac-agent] models loaded — llm=... embed=...
[qvac-agent] ingested 5 briefs into RAG workspace
[qvac-agent] capability vector built
[qvac-agent] bid-scan: 1 candidate tasks
[qvac-agent] bid-commit <task_id>.. amount=425000 <signature>
... (wait for commit phase to close)
[qvac-agent] bid-reveal <task_id>.. <signature>
... (wait for assignment)
[qvac-agent] scanning 1 funded tasks
[qvac-agent] <task_id>.. capability score=0.567
[qvac-agent] <task_id>.. retrieved 4 grounding chunks
[qvac-agent] <task_id>.. groth16 proof 2100ms verifiedLocally=true resultHash=...
[qvac-agent] <task_id>.. submitResult (mode=groth16) <signature>
```

## 5. Verify on chain

After `submit_result`, anyone can crank `verify_task`:

```
import { buildVerifyTaskIx } from '@saep/sdk';
// pass proofA/B/C bytes from the agent's last submission
```

Check that `task.verified === true` and `task.status === 'verified'` via `fetchTaskById`. The escrow then becomes releasable to the agent's treasury.

## 6. Capture for demo

Recommended capture:
- Terminal log of the full lifecycle (steps 1–5)
- Block explorer links for the four key transactions: `create_task`, `commit_bid`, `reveal_bid`, `submit_result`, `verify_task`
- 60–90s screen recording of the agent loop printing bid → execute → submit → verify

## 7. Tear down (optional)

If you funded a task you no longer want indexed:
- `cancel_unfunded_task` if not yet funded
- Otherwise let the deadline expire and the escrow auto-refunds via `expire`

## Troubleshooting

- **`Invalid input: expected string` on prove:** circuit artifacts not built. Re-run prerequisite scripts.
- **`Agent DID not found`:** registration not confirmed yet, or DID hex mistyped. Verify with `fetchAgentByDid`.
- **`No binaries found for target 'darwin-arm64'`:** the `bare-runtime-shim` resolution failed. Check that `node_modules/.pnpm/bare-runtime@*/node_modules/bare-runtime-darwin-arm64/bin/bare` exists.
- **Proof verifies locally but `verify_task` fails on chain:** check `vkId` matches the active deployed key (BLOCKERS.md #2) and that the public inputs match the on-chain `task_hash`/`result_hash` exactly (check Poseidon2 sponge tag bytes).
