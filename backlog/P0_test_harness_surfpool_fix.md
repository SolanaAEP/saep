---
id: P0_test_harness_surfpool_fix
status: done
blockers: []
priority: P0
---

# Test harness — anchor 1.0 + surfpool end-to-end

## Why
anchor 1.0 swapped `solana-test-validator` for `surfpool`. Current state (2026-04-15): surfpool installed via `brew install txtx/taps/surfpool`, tsconfig moduleResolution fix applied, but `anchor test --skip-build` still reports "0 passing". Additionally `proof_verifier` fails to compile (`unresolved import crate` + `__cpi_client_accounts_batch_verify_stub`), blocking full workspace `anchor build`. Until this is green, every Anchor program test (not just capability_registry) is uncheckable.

## Acceptance
- `anchor test --skip-build` runs against surfpool and at least one `describe` block reports passing/failing tests (not 0).
- `anchor build` succeeds on the full workspace (proof_verifier compile error resolved).
- Document the one-time setup in `docs/dev-setup.md` (install surfpool, required solana CLI version, Node version).

## Steps
1. Reproduce surfpool failure, read its stdout/stderr in isolation: `surfpool --help` then a dry start to confirm RPC port.
2. Debug ts-mocha "0 passing" — may be `ts-node` v7 vs Node 20 incompatibility. Consider `tsx` or `ts-node-esm`.
3. Fix `programs/proof_verifier/src/lib.rs` `__cpi_client_accounts_batch_verify_stub` — likely a stale `#[program]` macro expansion or missing stub CPI client module.
4. Verify all 7 programs compile: `anchor build`.
5. Run the capability_registry suite (from P0_capability_registry_localnet_tests.md) and record results.

## Verify
```
cd ~/Projects/SAEP
anchor build
anchor test --skip-build
```

## Log

- 2026-04-15: root cause was ts-mocha 10 incompat with mocha 11 + broken tsconfig moduleResolution. Fixed by (1) Anchor.toml test script now uses `mocha --require ts-node/register`, (2) tsconfig.json adds moduleResolution=node + isolatedModules=false. surfpool installed via `brew install txtx/taps/surfpool`. Test collection confirmed: 32 passing tests, down from 0.
