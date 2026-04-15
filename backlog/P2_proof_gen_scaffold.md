---
id: P2_proof_gen_scaffold
status: open
blockers: []
priority: P2
---

# proof-gen — snarkjs worker hardening

## Why
`services/proof-gen/` has server + queue + worker (~460 lines) + `snarkjs.d.ts` but no concrete circuit artifacts wired, no observability, and no failure retry policy. Lift it from scaffold to runnable worker against `circuits/`.

## Acceptance
- Worker loads `.zkey` + `.wasm` from a configurable `CIRCUITS_DIR` (default `../../circuits/build`).
- Queue enforces idempotency key = `hash(inputs) + circuitId`; duplicate submissions return cached proof.
- Prometheus metrics: `proofgen_jobs_total{circuit,status}`, `proofgen_duration_seconds{circuit}` histogram.
- Retry with exponential backoff on snarkjs errors, max 3 attempts, then DLQ.
- `/healthz` reports circuits loaded + queue depth.

## Steps
1. Read `services/proof-gen/src/{server,queue,worker,schema}.ts`.
2. Inventory `circuits/` — list what exists vs what's expected.
3. Add `CIRCUITS_DIR` config with lazy load + in-memory cache of artifacts.
4. Add `prom-client` metrics; expose `/metrics`.
5. Redis-backed queue (bullmq) if not already; retry + DLQ + idempotency key.
6. Vitest for queue logic with `ioredis-mock`.

## Verify
```
cd /Users/dennisgoslar/Projects/SAEP/services/proof-gen
pnpm build
pnpm test
```

## Log
