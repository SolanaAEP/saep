# SAEP × QVAC — Frontier Hackathon Submission

## What this is

A working SAEP reference agent whose inference runs entirely locally via Tether QVAC. The agent registers in `agent_registry`, accepts assigned tasks from `task_market`, runs RAG-grounded local inference using the QVAC SDK, and submits an execution commitment + result hash on-chain via `submitResult`. Source: [`examples/agents/qvac-local-agent/`](.).

## Why it fits the prize

The prize description says: integrate QVAC, submit, win. This goes beyond the minimum — the agent uses five distinct QVAC surfaces (`loadModel`, `completion`, `embed`, `ragIngest`, `ragSearch`) to do something autonomous-agent-shaped, not a one-shot completion demo.

It also fits SAEP's protocol thesis. SAEP exists so autonomous agents can hold treasuries and settle work without a centralized operator. Ridding the "brain" of centralization is the natural next step — and QVAC is the only credible local-AI runtime that ships today with embeddings + RAG + LLM in one SDK. The combination is genuinely novel.

## Demo path (for judges)

```bash
pnpm install
pnpm --filter @saep/qvac-local-agent demo
```

First run downloads ~1.1GB of GGUFs (Llama-3.2-1B Q4_0 + EmbeddingGemma-300M Q4_0) into QVAC's model cache. The demo runs three sample tasks:

1. **Governance digest** — in capability domain, agent retrieves the matching brief and produces a digest.
2. **Security triage** — in capability domain, agent retrieves and produces a triage note.
3. **Out-of-domain task** — capability scorer rejects it locally without burning LLM time.

Each in-domain task ends with a `resultHash` and a `proofKey` that an on-chain `submitResult` would commit. No RPC required for the demo.

## Architecture

```
┌──────────────────────── @saep/qvac-local-agent ────────────────────────┐
│                                                                        │
│   briefs/*.md ──► ragIngest ──┐                                        │
│                               ▼                                        │
│                          QVAC RAG workspace ──► ragSearch              │
│                                                      │                 │
│   task brief ──► embed ──► capability score          │                 │
│                              │                       ▼                 │
│                              ▼                 grounding chunks        │
│                         decide engage/skip          │                  │
│                                                     ▼                  │
│                                         completion (LLM, streaming)    │
│                                                     │                  │
│                                                     ▼                  │
│                          sha256 ──► resultHash ──► submitResult        │
│                          sha256(taskHash||result||models||t) ──► proofKey
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
                          │                                │
              @qvac/sdk (local, on-device)         @saep/sdk + Solana
```

## Files

| File | Purpose |
|---|---|
| `src/qvac-runtime.ts` | Loads + manages LLM and embedding models |
| `src/rag.ts` | Wraps `ragIngest` / `ragSearch` against a named workspace |
| `src/capability.ts` | `embed`-based capability vectors and cosine similarity |
| `src/grounded-completion.ts` | Builds grounded prompts, streams `completion` |
| `src/commitment.ts` | `resultHash` + `proofKey` execution commitment |
| `src/index.ts` | On-chain agent loop (devnet or mainnet) |
| `scripts/demo.ts` | Offline pipeline demo (no RPC) |
| `briefs/*.md` | Five capability definitions, each ingested as a RAG document |

## What's wired vs stubbed

**Wired:**
- QVAC LLM + embedding model loading
- RAG ingestion of brief corpus
- Per-task capability scoring via cosine similarity
- Per-task RAG retrieval + grounded completion
- Execution commitment computation (`resultHash` + `proofKey`)
- `task_market.submitResult` instruction building (dry-run by default)

**Stubbed (M2 milestones):**
- **Real Groth16 proof.** `proofKey` is currently a content commitment, not a zero-knowledge attestation. The SAEP `proof_verifier` Anchor program is deployed; wiring `services/proof-gen` to produce a real proof for an "agent produced output H for task T" circuit is the next milestone.
- **Off-chain brief catalog.** `task.taskHash` should resolve to an off-chain brief (IPFS / Arweave / Hyperdrive). Currently the demo uses the `SAEP_PROMPT_TEMPLATE` env var as a placeholder.
- **Bidding.** This agent does not bid. Pair with `examples/agents/defi-bidder` for the bid-and-reveal half of the lifecycle.

## Reproducibility checklist

- [x] Typechecks under `pnpm --filter @saep/qvac-local-agent typecheck`
- [x] Offline demo runs end-to-end with no RPC, no keypair, no prior on-chain state
- [x] First run downloads models from QVAC registry (no manual model setup)
- [x] No proprietary dependencies — pure `@qvac/sdk` + `@saep/sdk`
- [x] Apache-2.0 like the rest of SAEP

## Known QVAC v0.9.1 quirk

QVAC's Node-runtime path spawns a Bare subprocess to host the actual model code, which is loaded via `bare-runtime`'s native binary loader. That loader transitively requires `require-asset`, a Bare-only module that pnpm refuses to install on Node (`engines: { bare: '>=1.10.0' }`). The result is a `MODULE_NOT_FOUND` error before any model loads.

We work around it with a tiny ESM shim — `src/bare-runtime-shim.ts` — that resolves the platform binary's absolute path through `@qvac/sdk` and registers a fake CJS module under the expected platform-package name. The override installs at module-load time before any `@qvac/sdk` API is touched. Imported as the first line of `src/qvac-runtime.ts`.

Roughly 25 lines. Once QVAC ships a Node loader that doesn't go through `require-asset`, the shim can be deleted.

## License & attribution

Same as the parent repo (Apache-2.0). Built on `@qvac/sdk@0.9.1` (Tether) and `@saep/sdk` (this repo).
