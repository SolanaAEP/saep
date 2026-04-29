# QVAC Local Agent — Open Blockers

Items that need user input or external state before the agent can run truly end-to-end on devnet/mainnet. Captured here instead of stalling the build.

## 1. Local zkey doesn't match the registered devnet VK

`circuits/task_completion/scripts/setup.sh` runs a fresh single-contributor ceremony each time, producing a new zkey + VK with a new `vkId`. The devnet `proof_verifier` already has an active VerifierKey at PDA `3a7TRvfnUzvD3r4UhWwZPHbYVcQUrJoaq8WQuNQHw4ze` (vkId `b43ee0cd5bac7d014d513f518e4578731ac7e837e33b1d621c906aac5fda09ad`, label `task_completion_v1`, `isProduction=false`) — registered by an earlier ceremony whose zkey is **not in this repo** (gitignored, never committed).

So locally-generated proofs will pass `verifyProofLocally` but fail on-chain `verify_task` against the registered VK.

**To unblock — pick one:**
- **Recover the original zkey.** Check whoever registered the VK (`registered_by` is the same operator pubkey on devnet) for the matching `task_completion.zkey`.
- **Register a new VK matching the local zkey.** The proof_verifier authority is the same operator (`8xbXHAhiVe2BrYDq4qpTA5SSYJG9XNjNN6jcrudhTKCM`), so they have the right. But: `vk_activation` honors a 7-day timelock (`VK_ROTATION_TIMELOCK_SECS`) for any rotation after the first activation — the bootstrap path requires `active_vk == Pubkey::default()`, which devnet is past. So a new VK can be *registered* immediately via `init_vk` but won't *activate* for 7 days.
- **Deploy a fresh `proof_verifier` instance** for the hackathon and register our local VK as the first activation (bootstrap path). Heavyweight.
- **Demo lifecycle up to `submit_result` only,** acknowledging that `verify_task` will fail on chain because of the zkey mismatch. Honest but doesn't demonstrate the full settlement flip.

## 2. Active `vkId` discovery — RESOLVED

✅ Wired in `src/onchain-verify.ts::fetchActiveVerifierKey` — fetches `verifier_config.activeVk`, then the `VerifierKey` account at that address, returns vkId/circuitLabel/isProduction. The agent uses this vkId as `submit_result.proof_key` (falling back to `paddedCircuitLabel('task_completion_v1')` only when no active VK is resolvable).

## 3. Devnet agent registration

`SAEP_AGENT_DID` is required to run `pnpm start`. The agent must be registered in `agent_registry` with the operator keypair as the operator.

**To unblock:** run the existing register-agent flow (CLI or portal `/agents/register`) on devnet with a funded keypair, capture the DID hex.

## 4. `verify_task` instruction wiring — RESOLVED

✅ Wired in `src/onchain-verify.ts::submitVerifyTask`. The agent self-cranks `verify_task` after `submit_result` succeeds (controlled by `SAEP_ENABLE_AUTO_VERIFY`, on by default). The proof_a/b/c bytes come from `proofToTaskMarketBytes`, the vkId from the active VK fetched at startup.

**Note:** this completes the wiring but won't produce `task.verified=true` on chain until blocker #1 (zkey/VK match) is resolved.

## NEW: 5b. on-chain `task_hash` is keccak, circuit expects Poseidon2

The on-chain `task.task_hash` is `keccak256(task_id || payload_hash)` (see `programs/task_market/src/state.rs::derive_task_hash`). The Circom circuit's `task_hash` constraint is `Poseidon2(salt, task_preimage) == task_hash`. These are two different hash functions — the prover would need to find a Poseidon2 preimage of a keccak output, which is computationally infeasible.

**This means our locally-generated proofs cannot ever satisfy `verify_task`, regardless of zkey match,** unless:
- the circuit is revised to accept keccak inputs (out of scope), or
- the on-chain `derive_task_hash` is changed to Poseidon2 (out of scope), or
- we use the existing `compute` task kind (`{ circuitId, publicInputsHash }`) where `publicInputsHash` is set by the client to a Poseidon2 hash that the circuit can verify against — needs investigation.

**Action:** check whether spec 05's `task_hash` was ever intended to match `derive_task_hash`, or whether the canonical settlement path uses the `compute` task kind with a separate Poseidon2 commitment. The settlement-panel + portal proof-gen flow may already do something correct that we missed.

## 5. Brief catalog resolution

In production, `task.taskHash` should resolve to an off-chain brief (IPFS / Arweave / Hyperdrive) that both the agent and the proof's task_preimage are derived from. This scaffold uses a placeholder `SAEP_PROMPT_TEMPLATE`.

**Action:** decide a catalog scheme (e.g. CID embedded in task_payload's argsHash) and add a fetcher in `src/index.ts` that pulls the brief by hash before scoring.

## 6. @saep/sdk Node ESM quirk — RESOLVED at source

✅ Fixed in `packages/sdk/src/anchor.ts`. The browser bundle's `export { default as BN } from 'bn.js'` poisoned all named exports under strict Node ESM (the broken default-from-CJS re-export propagates to every `import { X }` from that file). Replaced with a direct `import BNDefault from 'bn.js'` for `BN` and the main `@coral-xyz/anchor` entry for `Program`. Static imports of `@saep/sdk` now work cleanly under Node 24 + tsx.

The dynamic-import workarounds in `src/saep-tools.ts` and `src/bid.ts` were reverted to clean static imports.

**Caveat:** `packages/sdk/dist/` is gitignored. A full `pnpm --filter @saep/sdk build` is needed in any fresh checkout to compile the new `anchor.ts` into `dist/anchor.js`. That build currently fails on a pre-existing unrelated typecheck error in `programs/treasury_standard.ts::setYieldStrategyStatus` — not introduced by these changes — which needs to be fixed before the SDK rebuild succeeds. A local manual recompile of just `src/anchor.ts → dist/anchor.js` works around it for development.

## 7. Tool-calling model context size

The Qwen3 1.7B tool-calling model is loaded with `ctx_size: 4096`. With long brief corpora + tool definitions + tool results in history, that limit can be hit. If the agent loop adds turns past round 2, raise `ctx_size` or compact tool-result content before re-prompting.
