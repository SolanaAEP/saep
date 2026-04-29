# SAEP × QVAC — Frontier Hackathon Submission

## What this is

A working SAEP reference agent whose inference runs entirely locally via Tether QVAC, and whose settlement runs on-chain on Solana with a **real Groth16 proof** that the on-chain `proof_verifier` accepts. The agent registers in `agent_registry`, watches `task_market`, scores incoming tasks via local embeddings, bids when capability matches, runs grounded inference (with optional native tool-calling into `@saep/sdk` fetchers), generates a Groth16 proof of completion, and posts it via `submit_result` + `verify_task`.

Source: [`examples/agents/qvac-local-agent/`](.).

## Why it deserves to win

**Five distinct QVAC surfaces in one agent**, not a one-shot completion demo:
- `loadModel` / `unloadModel` — LLM + embedding model lifecycle
- `completion` (streaming + native tool calls) — grounded generation, with a Qwen3-1.7B variant that emits `fetch_agent` / `fetch_task` / `fetch_treasury` tool calls during reasoning
- `embed` — capability vectors for the agent and incoming tasks; out-of-domain tasks declined via cosine similarity before LLM time is spent
- `ragIngest` / `ragSearch` — corpus of capability briefs in a named workspace, retrieved per task

**Real Groth16 zero-knowledge proof, not a content commitment.** The agent runs `snarkjs.groth16.fullProve` against the deployed `task_completion.v1` Circom circuit (5601 non-linear constraints, ~2s on CPU). Public inputs are Poseidon2 hashes of the brief and output that the on-chain `proof_verifier` Anchor program verifies via Light Protocol bn254 pairings. Verified locally as part of the demo.

**End-to-end on-chain settlement design.** `submit_result` + `verify_task` paths are wired through `@saep/sdk`. Capability-aware bid + reveal automation runs alongside the inference loop.

**Honest about what's a hackathon shortcut.** The trusted setup is dev-only (single-contributor ptau); see `BLOCKERS.md` for the production-readiness checklist.

## Demo paths

### 1. Offline pipeline (no RPC, no keypair, no devnet)

```bash
pnpm install

# One-time: build the local circuit artifacts
cd circuits/task_completion
bash scripts/compile.sh && bash scripts/setup.sh
cd -

# Run the demo
pnpm --filter @saep/qvac-local-agent demo
```

First run downloads ~1.1GB of GGUFs (Llama-3.2-1B Q4_0 + EmbeddingGemma-300M Q4_0) into QVAC's model cache. The demo runs three sample tasks:
1. **Governance digest** — in domain. Agent retrieves brief, runs grounded completion, generates a real Groth16 proof in ~2s, prints `verifiedLocally=true`.
2. **Security triage** — in domain. Same path, structured output following the brief's spec.
3. **Out-of-domain haiku** — declined locally at capability score 0.32 < threshold 0.35.

### 2. Native tool-calling (Qwen3 1.7B)

```bash
pnpm --filter @saep/qvac-local-agent tools-demo
```

Loads Qwen3-1.7B with `tools: true`, gives it `fetch_agent` / `fetch_task` / `fetch_treasury` tool definitions, then asks a question that requires on-chain data. The model emits a real native tool-call event (`→ fetch_agent({"did":"0xabc..."})`), the runtime executes the stub handler, and the model produces a final answer using the tool result.

Two-round ReAct loop, ~20s total elapsed.

### 3. Proof-only smoke (~3s)

```bash
pnpm --filter @saep/qvac-local-agent proof-smoke
```

Skips the LLM entirely; just generates and verifies a Groth16 proof from a fabricated brief+output to validate the circuit-side wiring on a fresh checkout.

### 4. On-chain agent loop (devnet)

See [`DEVNET_REHEARSAL.md`](./DEVNET_REHEARSAL.md) for the full register-agent → fund-task → bid → reveal → execute → submit → verify procedure.

## Architecture

```
┌──────────────────────── @saep/qvac-local-agent ────────────────────────┐
│                                                                        │
│   briefs/*.md ──► ragIngest ──► QVAC RAG workspace                     │
│                                       │                                │
│   task ──► embed (capability) ──► score                                │
│                │                                                       │
│                ├── below threshold → decline locally                   │
│                │                                                       │
│                ▼                                                       │
│           ragSearch (top-K=4) ──► grounding chunks                     │
│                                       │                                │
│                                       ▼                                │
│            completion (Llama, streaming)  ◄── Qwen3 + native tools     │
│                       │                          (fetch_agent etc.)    │
│                       │                                                │
│                       ▼                                                │
│   Poseidon2 sponge over (salt, brief), result chunks, criteria         │
│                       │                                                │
│                       ▼                                                │
│   snarkjs.groth16.fullProve(witness, wasm, zkey)  → proof + signals    │
│                       │                                                │
└───────────────────────┼────────────────────────────────────────────────┘
                        ▼
              ┌─────────────────────────────────┐
              │ task_market.submit_result       │
              │   (resultHash, proofKey=label)  │
              │ task_market.verify_task         │
              │   → CPI proof_verifier          │
              │   → task.verified = true        │
              └─────────────────────────────────┘
```

## Files

| File | Purpose |
|---|---|
| `src/qvac-runtime.ts` | Loads + manages LLM and embedding models, with the `bare-runtime` Node shim |
| `src/bare-runtime-shim.ts` | Workaround for QVAC v0.9.1's Node loader (`require-asset` is Bare-only) |
| `src/rag.ts` | Wraps `ragIngest` / `ragSearch` against a named workspace |
| `src/capability.ts` | `embed`-based capability vectors + cosine similarity |
| `src/grounded-completion.ts` | Builds grounded prompts, streams `completion` |
| `src/grounded-tool-completion.ts` | Native tool-calling variant (Qwen3) with a 2-round ReAct loop |
| `src/saep-tools.ts` | Tool definitions wrapping `@saep/sdk` fetchers (stub + live handlers) |
| `src/poseidon.ts` | Poseidon2 sponge + criteria Merkle proof matching the circuit |
| `src/proof.ts` | Builds + verifies the Groth16 proof; encodes proof bytes for `verify_task` |
| `src/commitment.ts` | Fallback execution commitment when circuit artifacts are missing |
| `src/bid.ts` | Capability-aware bid + reveal automation |
| `src/index.ts` | On-chain agent loop |
| `scripts/demo.ts` | Offline pipeline demo (no RPC) |
| `scripts/tools-demo.ts` | Native tool-calling demo (Qwen3) |
| `scripts/proof-smoke.ts` | Proof-only smoke test |
| `briefs/*.md` | Five capability definitions, each ingested as a RAG document |
| [`DEVNET_REHEARSAL.md`](./DEVNET_REHEARSAL.md) | Step-by-step devnet rehearsal procedure |
| [`BLOCKERS.md`](./BLOCKERS.md) | Open items needing user input or external state for full production readiness |

## Reproducibility checklist

- [x] Typechecks under `pnpm --filter @saep/qvac-local-agent typecheck`
- [x] `pnpm demo` runs end-to-end with no RPC: real Groth16 proofs, verifiedLocally=true
- [x] `pnpm tools-demo` runs end-to-end: Qwen3 emits a real native tool call, executes via stub handler, produces grounded final answer
- [x] `pnpm proof-smoke` validates the circuit wiring in ~3s
- [x] First run downloads models from QVAC registry (no manual model setup)
- [x] No proprietary dependencies — pure `@qvac/sdk` + `@saep/sdk` + `snarkjs` + `circomlibjs`
- [x] Apache-2.0 like the rest of SAEP

## Known shortcuts (documented honestly)

1. **Dev-only trusted setup.** `circuits/task_completion/scripts/setup.sh` runs a single-contributor powers-of-tau. Mainnet requires the real ceremony zkey. Devnet `proof_verifier` accepts a non-production VK.
2. **`vkId` resolution not yet wired.** Agent uses `paddedCircuitLabel('task_completion_v1')` as `proofKey` for `submit_result`. The on-chain `verify_task` needs the active `vkId` from `verifier_config.activeVk`. See `BLOCKERS.md` #2.
3. **Brief catalog.** Production agent would resolve `task.taskHash` against an off-chain catalog (IPFS / Hyperdrive). The scaffold uses `SAEP_PROMPT_TEMPLATE` as a placeholder.
4. **bn.js export quirk.** `@saep/sdk`'s compiled `anchor.js` uses the browser bundle's `BN` re-export, which doesn't resolve under strict Node ESM. The agent uses dynamic imports (`await import('@saep/sdk')`) inside tool handlers and bid logic to sidestep it. See `BLOCKERS.md` #6.

## QVAC v0.9.1 Node-loader workaround

QVAC's Node-runtime path spawns a Bare subprocess to host the actual model code, which is loaded via `bare-runtime`'s native binary loader. That loader transitively requires `require-asset`, a Bare-only module that pnpm refuses to install on Node (`engines: { bare: '>=1.10.0' }`). The result is a `MODULE_NOT_FOUND` error before any model loads.

We work around it with a tiny ESM shim — `src/bare-runtime-shim.ts` — that resolves the platform binary's absolute path through `@qvac/sdk` and registers a fake CJS module under the expected platform-package name. ~25 lines. Once QVAC ships a Node loader that doesn't go through `require-asset`, the shim can be deleted.

## License & attribution

Apache-2.0. Built on `@qvac/sdk@0.9.1` (Tether), `@saep/sdk` (this repo), `snarkjs` 0.7.4, and `circomlibjs`.
