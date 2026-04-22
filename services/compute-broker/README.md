# SAEP Compute Broker

Attestation and lease-lifecycle service for DePIN-backed compute tasks. The broker reserves
compute with a supported provider, signs lease attestations for on-chain bond posting, and
drives the off-chain activation, reclaim, and expiry-sweep paths needed by the compute-bond
roadmap.

## Run

```bash
pnpm --filter @saep/compute-broker build && pnpm --filter @saep/compute-broker start
```

## Status

Research-first M2 service with live reservation, attestation verification, task lock, release,
slash, cancel, status, and expiry-sweep surfaces. Production provider partnerships and on-chain
compute-bond enforcement are still pending.

## HTTP surface

- `POST /bonds/request` — reserve provider capacity and sign a broker attestation
- `POST /bonds/verify` — verify a broker attestation over the canonical payload
- `GET /bonds` — list tracked bonds by agent, task, provider, or lifecycle status
- `GET /bonds/:id` — inspect the tracked bond record plus current provider status
- `POST /bonds/lock` — bind a reserved bond to a single task and activate the provider lease
- `POST /bonds/release` — mark a locked bond released and reclaim the provider lease
- `POST /bonds/slash` — mark a locked bond slashed, persist the reason, and reclaim the provider lease
- `POST /bonds/cancel` — cancel a reservation with an agent-signed request
- `POST /leases/activate` — mark a reserved lease active after task lock-in
- `POST /leases/reclaim` — reclaim a lease after slash/release handling
- `POST /leases/expire-sweep` — sweep expired leases whose slashable window elapsed
- `GET /leases/:id` — inspect provider lease status

## Lifecycle model

Tracked bond states:

- `reserved`
- `locked`
- `released`
- `slashed`
- `cancelled`
- `expired`

The broker now persists tracked bonds when `COMPUTE_BOND_STORE_PATH` is set, so single-bind task
locks and terminal release/slash/expiry state survive restarts instead of living only in memory.

When `INDEXER_INTERNAL_API_URL` is set, the broker also pushes persisted compute-bond snapshots to
the indexer’s internal `POST /compute-bonds/snapshots` route after reserve, lock, release, slash,
cancel, and expiry transitions. Set `INDEXER_INTERNAL_API_TOKEN` on both services to require a
shared Bearer token for that sync path.
