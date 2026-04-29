# QVAC Local Agent — Open Blockers

Items that need user input or external state before the agent can run truly end-to-end on devnet/mainnet. Captured here instead of stalling the build.

## 1. Production trusted setup

The Groth16 proof currently uses the **dev-only** SRS produced by `circuits/task_completion/scripts/setup.sh` — a single-contributor powers-of-tau ceremony. The proof verifies locally but the on-chain `proof_verifier` rejects any verifier key flagged `is_production = false`.

**To unblock for real settlement:**
- Use the production verifier key registered on the active `proof_verifier` deployment (the one `task_market.global.proof_verifier` points to).
- For mainnet specifically: only proofs against the mainnet ceremony zkey will verify on chain. See `circuits/ceremony/phase2/README.md`.
- For devnet: the deployed `proof_verifier` already accepts a non-production VK — the agent just needs the `vkId` registered in `verifier_key` PDAs.

## 2. Active `vkId` discovery

The agent currently uses `paddedCircuitLabel('task_completion_v1')` as the 32-byte `proofKey` it writes into `submit_result`. The actual on-chain `verify_task` call needs the matching `vkId`, which is the seed used to derive the `verifier_key` PDA.

**Action:** add a fetch step at agent startup that resolves the active `vkId` via:

```ts
import { fetchVerifierConfig, fetchVerifierKey } from '@saep/sdk';
const config = await fetchVerifierConfig(verifierProgram);
// config.activeVk is the verifier_key PDA address
const activeKey = await fetchVerifierKey(verifierProgram, config.activeVk);
// Use activeKey.vkId (32 bytes) as the proofKey for submit_result.
```

## 3. Devnet agent registration

`SAEP_AGENT_DID` is required to run `pnpm start`. The agent must be registered in `agent_registry` with the operator keypair as the operator.

**To unblock:** run the existing register-agent flow (CLI or portal `/agents/register`) on devnet with a funded keypair, capture the DID hex.

## 4. `verify_task` instruction not yet wired into agent

The agent calls `submit_result` (which records the result + proof_key on chain) but does **not** call `verify_task` (which CPIs into `proof_verifier` to actually verify the Groth16 proof and flip `task.verified`).

**Action:** after `submit_result` succeeds, build a `verify_task` instruction with proof_a/b/c bytes (already computed via `proofToTaskMarketBytes`) plus the active `vkId` from blocker #2. Either the agent itself or any cranker can submit it. See `packages/sdk/src/programs/task_market.ts::buildVerifyTaskIx`.

## 5. Brief catalog resolution

In production, `task.taskHash` should resolve to an off-chain brief (IPFS / Arweave / Hyperdrive) that both the agent and the proof's task_preimage are derived from. This scaffold uses a placeholder `SAEP_PROMPT_TEMPLATE`.

**Action:** decide a catalog scheme (e.g. CID embedded in task_payload's argsHash) and add a fetcher in `src/index.ts` that pulls the brief by hash before scoring.

## 6. @saep/sdk runtime quirk

`@saep/sdk`'s compiled `anchor.js` does `import { BN } from '@coral-xyz/anchor/dist/browser/index.js'`. Under strict Node ESM resolution (tsx + Node 24), the `BN` named export from the browser bundle isn't visible synchronously, so a top-level static import of @saep/sdk will throw at module-load.

**Workaround in this agent:** all @saep/sdk imports inside `src/saep-tools.ts` and `src/bid.ts` are *dynamic* (`await import('@saep/sdk')`) so the failing static-import path never fires for purely-offline code paths (demo, tools-demo, proof-smoke). The `src/index.ts` on-chain loop still uses a top-level import, which works in CI but may surface on some Node + tsx combos.

**Real fix:** rebuild the SDK's `anchor.ts` to either re-export BN explicitly (`import BN from 'bn.js'; export { BN };`) or stop going through the browser bundle for Node consumers.

## 7. Tool-calling model context size

The Qwen3 1.7B tool-calling model is loaded with `ctx_size: 4096`. With long brief corpora + tool definitions + tool results in history, that limit can be hit. If the agent loop adds turns past round 2, raise `ctx_size` or compact tool-result content before re-prompting.
