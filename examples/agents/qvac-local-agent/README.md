# QVAC Local Agent

A reference SAEP agent that does its inference locally via [Tether QVAC](https://qvac.tether.io) and settles on-chain via `task_market`.

The thesis: **autonomous agents shouldn't depend on a centralized LLM operator any more than they should depend on a centralized custodian.** SAEP gives agents on-chain rails (identity, treasuries, task market, settlement). QVAC gives them brains that run on the operator's own hardware. This example is the seam between the two — the smallest credible end-to-end agent that uses both.

## What it does

1. **Loads two local models** via `@qvac/sdk`: Llama-3.2-1B Q4_0 for generation, EmbeddingGemma-300M Q4_0 for retrieval. Both download to QVAC's model cache on first run (~1.1GB total).
2. **Ingests a brief corpus** (`briefs/*.md`) into a QVAC RAG workspace. Each brief defines one capability the agent claims — what inputs it expects, what output shape, why local inference matters for that capability.
3. **Builds a capability vector** by `embed()`-ing a summary of the corpus. Incoming task prompts are scored against this vector — tasks that don't look like any claimed capability get declined locally without burning LLM time.
4. **For each in-flight on-chain task** assigned to this agent (`task_market` status `funded`), it does a `ragSearch` for the most relevant brief chunks, runs a grounded `completion()` against those chunks, hashes the output, and builds an execution commitment.
5. **Submits the result** via `task_market.submitResult` with `resultHash = sha256(output)` and `proofKey = sha256(taskHash || resultHash || llmSrc || embedSrc || issuedAt)`. Dry-run by default.

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

- **`proofKey` is an execution commitment, not a zero-knowledge proof.** It's `sha256(taskHash || resultHash || llmSrc || embedSrc || issuedAt)` — a verifiable hash chain that pins the result to a specific model and task, but it is *not* a Groth16 attestation. Wiring `proof_verifier` end-to-end (generating a real proof in `services/proof-gen` for an "agent produced output H for task T" circuit) is the M2 milestone.
- **Briefs are local, not on-chain.** A real agent would resolve `task.taskHash` to an off-chain catalog (IPFS, Arweave, Hyperdrive) holding the actual brief. This example uses the `SAEP_PROMPT_TEMPLATE` env var as a placeholder for that fetch.
- **The agent does not bid.** It assumes assignment via `defi-bidder` (`../defi-bidder`) or off-chain. End-to-end demo would chain the two.

## Run on devnet

```bash
SAEP_AGENT_DID=<agent-did-hex-or-base58> \
SAEP_KEYPAIR=~/.config/solana/id.json \
pnpm --filter @saep/qvac-local-agent start
```

The keypair must be the agent's `operator`. First run downloads the GGUFs.

## Run the offline demo

```bash
pnpm --filter @saep/qvac-local-agent demo
```

Runs the full QVAC pipeline (load → ingest → embed-score → search → grounded-complete → commit) against three sample tasks, no RPC calls. Two tasks fall inside the agent's capabilities; one is out-of-domain and gets declined by the capability scorer. This is the path judges should run.

## Knobs

- `SAEP_ENABLE_SUBMIT=true` — actually send `submitResult` transactions. Default is dry-run.
- `SAEP_CLUSTER=devnet|mainnet` — defaults to `devnet`.
- `SAEP_RPC_URL=<url>` — override cluster endpoint.
- `SAEP_POLL_MS=30000` — task scan interval.
- `SAEP_PROMPT_TEMPLATE` — prompt template, `{taskHash}` substituted with the task hash hex.
- `SAEP_BRIEFS_DIR` — path to the briefs corpus. Default is `./briefs`.
- `SAEP_CAPABILITY_THRESHOLD` — minimum cosine similarity (0–1) for the agent to engage. Default `0.35`.

## Platform notes

QVAC's `bare`-runtime addons ship native binaries for llama.cpp + Vulkan/Metal. Tested on Node 20+ via tsx on macOS/Linux. Model downloads are not bundled — first run streams them from the QVAC registry.

`src/bare-runtime-shim.ts` works around a v0.9.1 Node-loader quirk where pnpm refuses to install `require-asset` (a Bare-only dep). The shim is short (~25 lines) and self-removes once QVAC ships a Node-friendly loader. See `HACKATHON.md` for details.
