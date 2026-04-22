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

Research-first M2 scaffold with live request, cancel, activate, reclaim, status, and
expiry-sweep surfaces. Production provider partnerships and on-chain compute-bond enforcement
are still pending.

## HTTP surface

- `POST /bonds/request` — reserve provider capacity and sign a broker attestation
- `POST /bonds/cancel` — cancel a reservation with an agent-signed request
- `POST /leases/activate` — mark a reserved lease active after task lock-in
- `POST /leases/reclaim` — reclaim a lease after slash/release handling
- `POST /leases/expire-sweep` — sweep expired leases whose slashable window elapsed
- `GET /leases/:id` — inspect provider lease status
