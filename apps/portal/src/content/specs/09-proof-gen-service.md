# Spec 09 — Proof-Gen Service

**Owner:** scaffolder + zk-circuit-engineer
**Depends on:** 05 (circuit artifacts), 06 (verifier public-input order), 08 (IACP can fan out job status)
**Blocks:** 07 verify_task happy path (needs real proofs), 10 portal "submit result" button
**References:** backend PDF §3.2 (proof service), §5.1 (witness privacy), §2.4 (public-input order — task_hash, result_hash, deadline, submitted_at, criteria_root)

## Goal

Off-chain HTTP service that turns a task-completion witness into a Groth16 proof. Agents POST witness inputs, receive a job id, poll for a `(proof, public_signals)` result usable by `task_market::verify_task`. Fully off-chain. **CU / CPI: none.**

Two concerns dominate:

1. **Sensitive witnesses.** `task_preimage`, `result_preimage`, `salt`, `criteria_satisfied` leak the agent's work if they land in plaintext Redis. All private inputs are encrypted at rest with a per-job key; the key is held only in the API process memory until the worker consumes it.
2. **Time-to-proof.** A ~2.5k-constraint Groth16 proof is ~2–4s single-threaded. We serialize per-worker but parallelize across workers; queue visible so callers can back-pressure.

## Architecture

```
 agent ──POST /prove (SIWS) ──► Fastify API ──► BullMQ queue (Redis)
                                    │                   │
                                    │ enqueue jobId     │
                                    ▼                   ▼
                             in-mem key map      Worker pool (N procs)
                                                  │
                                                  │ 1. decrypt witness
                                                  │ 2. snarkjs.groth16.fullProve
                                                  │ 3. store {proof, public_signals}
                                                  ▼
                                             Redis result hash (TTL 1h)
 agent ──GET /jobs/:id ────────► Fastify API ──► read Redis
```

Single Redis instance is sufficient M1. Horizontal scale: add workers; API stays stateless except for the short-lived per-job key cache (10-min TTL — if the worker misses that window the job fails and client resubmits).

## HTTP API

All endpoints JSON.

### `POST /prove`
Auth: SIWS bearer (`// SIWS-AUTH-STUB`).

Body (see `schema.ts`):
```jsonc
{
  "circuit_id": "task_completion.v1",
  "public_inputs": {
    "task_hash": "0x...",
    "result_hash": "0x...",
    "deadline": "1712345678",
    "submitted_at": "1712345600",
    "criteria_root": "0x..."
  },
  "private_inputs": {
    "task_preimage": ["0","1",...],     // length N_TASK = 16
    "result_preimage": ["..."],          // length N_RESULT = 32
    "salt": "0x...",
    "criteria_satisfied": ["1",...],     // length K = 8
    "criteria_path": ["...","...","..."],// length LOG_K = 3
    "criteria_index": ["0","1","0"]
  }
}
```

Response `202`: `{ "job_id": "uuid", "status": "queued" }`
Response `503`: `{ "error": "no_artifacts" }` when circuit build dir is empty (`NO-ARTIFACTS-YET`).
Response `429`: when the per-agent rate limit is tripped (`RATE-LIMIT-STUB`).

### `GET /jobs/:id`
Response shapes:
- `{ status: "queued" | "active" }`
- `{ status: "completed", proof: {...}, public_signals: [...] }`
- `{ status: "failed", error: "..." }`
- `404` if unknown / expired

### `GET /healthz`
Returns `{ ok: true, redis: "up"|"down", artifacts: "present"|"missing" }`. Used by Render's health probe.

## Auth

SIWS Bearer token on `POST /prove`. The token resolves to an `agent_did` + operator pubkey; this tuple keys both the rate limiter and per-agent proof cache. M1 stubs the resolver (`// SIWS-AUTH-STUB`) to accept any non-empty bearer and map to `"agent:dev"`. Real auth lands with the SDK SIWS helper (shared with IACP).

## Rate limiting

Per-agent token bucket, 10/min burst, 2/min sustained. Exceeding returns `429 { retry_after }`. Implementation stubbed (`// RATE-LIMIT-STUB`) — will back onto the same Redis via `@fastify/rate-limit` with a custom key function returning the resolved `agent_did`.

## Queue architecture (BullMQ)

- Queue name: `proof-gen`
- Job data: `{ circuit_id, public_inputs, witness_ciphertext, witness_iv, agent_did }`
- The decryption key is **not** in the job data — it lives in the API process keyed by `job.id` and is handed to the worker via a separate Redis key `proof-gen:key:<job_id>` with 10-minute TTL (see security notes).
- Concurrency: `PROOFGEN_WORKER_CONCURRENCY` (default 1 per process; scale horizontally by starting more worker processes)
- Retry: 2 attempts, exponential backoff starting at 5s. A failure on attempt 3 is terminal — witness is destroyed, job marked `failed`.
- Result TTL: 1h (`PROOFGEN_RESULT_TTL_SEC`). After TTL the job row is evicted.
- Dead-letter: BullMQ `failed` state with full error; op dashboard (spec'd, not built M1) surfaces them.

## Proof caching

Keyed by `sha256(circuit_id || canonical_json(public_inputs))`. Private inputs intentionally excluded from the key — two runs with the same public inputs produce equivalent proofs as far as the verifier is concerned, and sharing them across agents is fine because public inputs alone authenticate the statement.

Stubbed (`// PROOF-CACHE-STUB`). Will write `proof-gen:cache:<hash>` with the completed result JSON and a matching TTL. A cache hit short-circuits enqueue and returns `completed` immediately from `POST /prove` (the route stays 202-shaped with `status: "completed"` rather than `"queued"`).

## Failure policy

| Failure | Behavior |
|---|---|
| Redis down on enqueue | 503, agent retries |
| Redis down mid-proof | BullMQ's own retry handles reconnect; job resumes |
| Artifacts missing | `POST /prove` 503 pre-enqueue (`NO-ARTIFACTS-YET` gate) |
| Witness invalid (snarkjs throws) | Job `failed` with sanitized error; no witness bytes in the error field |
| Worker crash mid-proof | BullMQ stalled-check re-runs after visibility timeout (30s) |
| Public inputs ≠ regenerated public signals | Job `failed` with `public_input_mismatch` — protects against client lying about public inputs |

## Observability

- pino structured logs, `level = LOG_LEVEL` env
- Each log line carries `job_id`, `agent_did`, `circuit_id`
- Never log witness bytes, ciphertext, or decryption keys — enforced by a pino redact list
- Metrics (deferred M1): proof duration histogram, queue depth, cache hit rate, 4xx/5xx counters

## Security notes

**Witness confidentiality (`WITNESS-ENCRYPT-STUB`).** On `POST /prove`:
1. API generates 32-byte key + 12-byte IV via `crypto.randomBytes`
2. `private_inputs` JSON encrypted with AES-256-GCM
3. Job payload carries ciphertext + IV + auth tag; plaintext is zeroed
4. Key written to `proof-gen:key:<job_id>` with 10-min TTL, owner = worker ACL (single shared-secret ACL M1; proper Redis ACL in M2)
5. Worker fetches key, decrypts, runs snarkjs, deletes key, zeroes plaintext buffer

If the worker crashes after fetching but before completing, the key is gone on retry — job fails, client resubmits. This bounds the exposure window to a single proof run.

**Why in Redis at all.** We considered keeping the key in the API process and streaming it to the worker over a side channel, but (a) workers scale independently, (b) a 10-min TTL in Redis is tighter than keeping plaintext in any process. The Redis is local to the service (same VPC on Render); an attacker with Redis read access already has ciphertext and would only lack the auth tag's integrity guarantee — they cannot recover the witness without the key.

**Bearer tokens.** Never logged. Resolver result cached 60s to avoid per-request RPC hit.

**Proof forgery.** A malicious caller can always feed fake `private_inputs` that don't satisfy the circuit — snarkjs will fail, we return `failed`. What they **cannot** do is exfiltrate another agent's witness because witness material never crosses agents.

**Dependency surface.** snarkjs pulls native-bigint and ffjavascript; both are in-process and have no network I/O. circomlibjs is only needed if we pre-hash inputs server-side — currently clients send already-Poseidon-hashed public inputs, so circomlibjs is listed as a future dep but not imported M1.

## Artifacts

Loaded from `CIRCUIT_ARTIFACTS_DIR` (default `../../circuits/task_completion/build`). Expected files:
- `task_completion.wasm`
- `task_completion.zkey`
- `verification_key.json` (self-check at boot; mismatch refuses to serve)

Circuit-id → artifact-path resolution stubbed (`// CIRCUIT-ARTIFACT-LOAD-STUB`). M1 hardcodes `task_completion.v1`. M2 reads a registry keyed by verifier-contract-version.

## Done checklist

- [ ] Spec written (this file)
- [ ] Scaffold compiles clean under `pnpm --filter @saep/proof-gen typecheck`
- [ ] All five stubs marked in code
- [ ] `NO-ARTIFACTS-YET` gate returns 503 when build dir is empty
- [ ] `.env.example` committed
- [ ] Integration test (end-to-end with real artifacts) deferred to post-circuit-build
- [ ] Security auditor pass — witness-at-rest model reviewed
- [ ] Reviewer gate
