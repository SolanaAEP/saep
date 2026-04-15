---
id: P0_capability_registry_localnet_tests
status: done
blockers: []
priority: P0
---

# capability_registry — localnet test coverage

## Why
Devnet deploy is blocked on SOL airdrop. Localnet (`solana-test-validator` via `anchor test`) needs no funding and lets us harden the program before devnet is available. `tests/capability_registry.ts` exists (107 lines) but coverage is thin.

## Acceptance
- `anchor test --skip-deploy=false` passes on a fresh localnet.
- Coverage for: init_global (happy path + duplicate init rejection), register_capability (admin-only, bad-authority rejection), update_capability, disable/enable, and at least one event-emission assertion per state-changing ix.
- All 32 canonical capabilities in `programs/capability_registry/src/` registerable in a single test run without account-size overflow.

## Steps
1. Read `programs/capability_registry/src/lib.rs` — map every ix + error code.
2. Extend `tests/capability_registry.ts` with `describe` blocks per ix.
3. Add a helper in `tests/helpers/` for batch-registering the 32 caps if not already present.
4. Assert emitted events via `getParsedTransaction` + IDL event decoder (reuse indexer's borsh decoder pattern if convenient).

## Verify
```
cd /Users/dennisgoslar/Projects/SAEP
anchor build
anchor test -- --features localnet
```

## Log

- 2026-04-15: full ix + event coverage landed, 13 sub-tests green under surfpool. anchor test — 32 passing, 27 pending (other programs). Co-resolved with P0_test_harness_surfpool_fix.
