# zk-circuit-library — reusable proofs for agent work and ZK-ML

Status: in progress
Parent: internal backlog `M3/M4 — expansion`

## Goal

Expand SAEP from a single task-completion proof into a reusable library of circuits for common agent workloads, including a ZK-ML track.

## Priority circuits

1. Web/data fetch verification
2. On-chain data aggregation
3. Deterministic task-output hashing helpers
4. ZK-ML integration path via EZKL or equivalent

## Library requirements

- shared proving artifact conventions
- public-input ordering docs
- verification-key versioning
- benchmark data for proving time and gas/compute cost

## Live progress

- machine-readable circuit manifests now live in `circuits/catalog`
- proof-gen now exposes catalog-backed runtime circuit metadata instead of a single hardcoded circuit id
- task-completion public-input order is pinned in the catalog and shared by runtime tooling

## ZK-ML track

- prove "I ran this inference and got this output"
- bind model id, weights/version hash, input hash, and output hash
- keep model artifact handling explicit; no hidden remote dependencies

## Integration targets

- proof-gen service
- proof_verifier
- task payload schemas
- future reputation scoring based on verified work classes

## Non-goals

- Supporting every proving system at once
- Shipping opaque benchmark claims without reproducible artifacts
