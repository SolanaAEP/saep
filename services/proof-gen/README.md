# @saep/proof-gen

Off-chain Groth16 prover for the SAEP task-completion circuit. Agents POST a witness, get back a `(proof, public_signals)` blob that `task_market::verify_task` can consume.

See `specs/09-proof-gen-service.md` for the full contract.

## Run

```
cp .env.example .env
pnpm --filter @saep/proof-gen build
pnpm --filter @saep/proof-gen start           # fastify api
pnpm --filter @saep/proof-gen start:worker    # bullmq worker
```

API and worker are separate processes so they scale independently. Both need the same `REDIS_URL` and `CIRCUIT_ARTIFACTS_DIR`.

## Endpoints

- `POST /prove` — SIWS-bearer, JSON body (see `src/schema.ts`). 202 with `{ job_id }`, 503 if circuit artifacts aren't built yet.
- `GET /jobs/:id` — `queued | active | completed | failed`.
- `GET /healthz` — liveness + artifact presence.

## Stubs

All stubs are marked with a `// <TAG>` comment. Current list:

- `SIWS-AUTH-STUB` (`src/server.ts`)
- `RATE-LIMIT-STUB` (`src/server.ts`)
- `WITNESS-ENCRYPT-STUB` (`src/server.ts`)
- `CIRCUIT-ARTIFACT-LOAD-STUB` (`src/worker.ts`)
- `PROOF-CACHE-STUB` (`src/server.ts`, `src/worker.ts`)
- `NO-ARTIFACTS-YET` (`src/server.ts`) — 503 gate, not a stub per se but flagged

## Artifacts

Expects `task_completion.wasm` + `task_completion.zkey` under `CIRCUIT_ARTIFACTS_DIR`. Until circom is installed on the build host, the service boots but every `POST /prove` returns 503 `no_artifacts`. `GET /healthz` reports `"artifacts": "missing"`.
