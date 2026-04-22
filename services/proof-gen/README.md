# @saep/proof-gen

Off-chain Groth16 prover for SAEP proof circuits. The live runtime is still task completion today, but the service now reads the machine-readable circuit catalog so new proof classes can share one routing surface.

See `specs/09-proof-gen-service.md` for the full contract.

## Run

```
cp .env.example .env
pnpm --filter @saep/proof-gen build
pnpm --filter @saep/proof-gen start           # fastify api
pnpm --filter @saep/proof-gen start:worker    # bullmq worker
```

API and worker are separate processes so they scale independently. Both need the same `REDIS_URL`. Circuit metadata comes from `CIRCUIT_CATALOG_DIR` (default `../../circuits/catalog`) and artifact lookup comes from `CIRCUIT_BUILD_ROOT` (default `../../circuits`).

## Endpoints

- `POST /prove` — SIWS-bearer, JSON body (see `src/schema.ts`). 202 with `{ job_id }`, 503 if the selected live circuit artifacts aren't built yet.
- `GET /jobs/:id` — `queued | active | completed | failed`.
- `GET /healthz` — liveness + circuit/artifact presence.
- `GET /circuits` — live catalog view with runtime ids, public-input order, and artifact readiness.

## Stubs

All stubs are marked with a `// <TAG>` comment. Current list:

- `SIWS-AUTH-STUB` (`src/server.ts`)
- `RATE-LIMIT-STUB` (`src/server.ts`)
- `WITNESS-ENCRYPT-STUB` (`src/server.ts`)
- `PROOF-CACHE-STUB` (`src/server.ts`, `src/worker.ts`)
- `NO-ARTIFACTS-YET` (`src/server.ts`) — 503 gate, not a stub per se but flagged

## Artifacts

Artifact paths are derived from the catalog conventions:

- runtime id: `<slug_with_underscores>.v<version>`
- wasm: `circuits/<slug_with_underscores>/build/<slug_with_underscores>_js/<slug_with_underscores>.wasm`
- zkey: `circuits/<slug_with_underscores>/build/<slug_with_underscores>.zkey`
- verification key: `circuits/<slug_with_underscores>/build/verification_key.json`

Until circom artifacts exist for a live circuit, `POST /prove` for that circuit returns `503 no_artifacts`. `GET /healthz` and `GET /circuits` expose the same readiness state.
