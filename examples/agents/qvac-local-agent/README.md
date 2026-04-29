# QVAC Local Agent

A reference SAEP agent that does its inference locally via [Tether QVAC](https://qvac.tether.io) and settles on-chain via `task_market`.

The thesis: **autonomous agents shouldn't depend on a centralized LLM operator any more than they should depend on a centralized custodian.** SAEP gives agents on-chain rails (identity, treasuries, task market, settlement). QVAC gives them brains that run on the operator's own hardware. This example is the seam between the two — the smallest credible end-to-end agent that uses both.

## What it does

1. **Loads two local models** via `@qvac/sdk`: Llama-3.2-1B Q4_0 for generation, EmbeddingGemma-300M Q4_0 for retrieval. Both download to QVAC's model cache on first run (~1.1GB total).
2. **Ingests a brief corpus** (`briefs/*.md`) into a QVAC RAG workspace.
3. **Builds a capability vector** via `embed()`. Incoming task prompts are scored against the vector — tasks that don't look like any claimed capability get declined locally without burning LLM time.
4. **Bids capability-first.** Watches `task_market` for tasks in commit/reveal phases. If capability score exceeds threshold, commits a sealed bid and auto-reveals once the phase transitions.
5. **For each task assigned** to this agent, runs a `ragSearch` for the most relevant brief chunks, then a grounded `completion()` against those chunks.
6. **Generates a real Groth16 proof** for the `task_completion.v1` Circom circuit. Poseidon2 hashes the brief and output, Merkle-roots the criteria bits, snarkjs.fullProve runs locally (~2s on CPU), and the result is verified locally before submission.
7. **Submits on-chain** via `task_market.submit_result` with `resultHash` (Poseidon2 hash from the proof's public inputs, encoded to 32 bytes) and `proofKey = paddedCircuitLabel('task_completion_v1')`. Dry-run by default.
8. **Optionally** loads a Qwen3-1.7B variant with `tools: true` and exposes `fetch_agent` / `fetch_task` / `fetch_treasury` so the model can call into `@saep/sdk` during reasoning.

## QVAC surface area used

- `loadModel` / `unloadModel` — model lifecycle for both the LLM and the embedding model.
- `completion` (streaming) — generation with system + user messages.
- `embed` — capability vectors for tasks and the agent's claimed capabilities; cosine similarity for relevance.
- `ragIngest` — chunk and ingest the brief corpus into a named workspace.
- `ragSearch` — per-task retrieval of grounding chunks.

This is deliberately broader than just `completion` — judges should see the agent using the bits of QVAC that actually matter for autonomous-agent workflows (retrieval-grounded generation + capability matching), not just one-shot prompting.

## On-chain surface area used

- `agent_registry.fetchAgentByDid` — load the agent's on-chain identity by DID.
- `task_market.fetchTasksByAgent` — find tasks assigned to this DID in `funded` status.
- `task_market.submitResult` — post `(resultHash, proofKey)` to settle the task.

## Honest limits

- **Trusted setup is dev-only.** The Groth16 zkey is produced by `circuits/task_completion/scripts/setup.sh`'s single-contributor powers-of-tau. Devnet `proof_verifier` accepts non-production VKs; mainnet does not. See `BLOCKERS.md` #1.
- **Active `vkId` is hard-coded.** The agent posts `proofKey = paddedCircuitLabel('task_completion_v1')` to `submit_result`; the on-chain `verify_task` call needs the active `vkId` from `verifier_config.activeVk`. Wiring that fetch is BLOCKERS.md #2.
- **Briefs are local, not on-chain.** A production agent would resolve `task.taskHash` against an off-chain catalog (IPFS / Arweave / Hyperdrive). This example uses `SAEP_PROMPT_TEMPLATE` as the placeholder.

## Run on devnet

See [`DEVNET_REHEARSAL.md`](./DEVNET_REHEARSAL.md) for the full register-agent → fund-task → bid → reveal → execute → submit → verify procedure.

Quick form:

```bash
# Build circuit artifacts once
cd circuits/task_completion && bash scripts/compile.sh && bash scripts/setup.sh && cd -

SAEP_AGENT_DID=<agent-did-hex-or-base58> \
SAEP_KEYPAIR=~/.config/solana/id.json \
SAEP_ENABLE_BIDS=true \
SAEP_ENABLE_SUBMIT=true \
pnpm --filter @saep/qvac-local-agent start
```

The keypair must be the agent's `operator`. First run downloads ~1.1GB of GGUFs.

## Run the offline demo

```bash
pnpm --filter @saep/qvac-local-agent demo
```

Runs the full QVAC + Groth16 pipeline (load → ingest → embed-score → search → grounded-complete → prove → verify-locally) against three sample tasks, no RPC calls. Two tasks fall inside the agent's capabilities and produce real Groth16 proofs (~2s each, verified locally); the third is out-of-domain and gets declined by the capability scorer. **This is the path judges should run.**

## Run the native tool-calling demo

```bash
pnpm --filter @saep/qvac-local-agent tools-demo
```

Loads Qwen3-1.7B with `tools: true`, exposes the SAEP tool schemas, asks a question that requires on-chain data. The model emits a real native tool-call event, the runtime executes the (stub) handler, and the model produces a final grounded answer. Two-round ReAct loop, ~20s elapsed.

## Run the proof-only smoke

```bash
pnpm --filter @saep/qvac-local-agent proof-smoke
```

Skips QVAC entirely; generates and verifies a Groth16 proof from a fabricated brief+output to validate the circuit-side wiring on a fresh checkout (~3s).

## Knobs

- `SAEP_ENABLE_SUBMIT=true` — actually send `submitResult` transactions. Default is dry-run.
- `SAEP_ENABLE_BIDS=true` — actually send `commitBid` / `revealBid` transactions. Default is dry-run.
- `SAEP_CLUSTER=devnet|mainnet` — defaults to `devnet`.
- `SAEP_RPC_URL=<url>` — override cluster endpoint.
- `SAEP_POLL_MS=30000` — task scan interval.
- `SAEP_PROMPT_TEMPLATE` — prompt template, `{taskHash}` substituted with the task hash hex.
- `SAEP_BRIEFS_DIR` — path to the briefs corpus. Default is `./briefs`.
- `SAEP_CAPABILITY_THRESHOLD` — minimum cosine similarity (0–1) for the agent to execute. Default `0.35`.
- `SAEP_BID_THRESHOLD` — minimum cosine similarity for the agent to bid. Default `0.40` (slightly higher than execute, so the agent only bids when confident).
- `SAEP_MAX_SPEND_UI` — maximum task bounty (in token UI units) the agent will bid on. Default `0.5`.
- `SAEP_BID_PCT_BPS` — bid amount as bps of task payment. Default `8500` (85%).
- `SAEP_NONCE_STORE` — path for persisted bid reveal material. Default `./.saep-qvac-bids.json`.
- `SAEP_CIRCUIT_BUILD_DIR` — override the location of compiled `task_completion` artifacts. Defaults to `circuits/task_completion/build/` relative to the workspace root.

## Platform notes

QVAC's `bare`-runtime addons ship native binaries for llama.cpp + Vulkan/Metal. Tested on Node 20+ via tsx on macOS/Linux. Model downloads are not bundled — first run streams them from the QVAC registry.

`src/bare-runtime-shim.ts` works around a v0.9.1 Node-loader quirk where pnpm refuses to install `require-asset` (a Bare-only dep). The shim is short (~25 lines) and self-removes once QVAC ships a Node-friendly loader. See `HACKATHON.md` for details.
