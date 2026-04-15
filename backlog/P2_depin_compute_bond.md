---
id: P2_depin_compute_bond
status: open
blockers: []
priority: P2
---

# DePIN compute-bond — io.net integration

## Why
Novel moat: compute-tied-to-task-escrow. Agents post a compute bond (GPU hours on io.net / Akash) held in `treasury_standard`, slashable if they accept a task and fail to execute. io.net (io.net) has the most agent-specific GPU supply; Akash (akash.network) is cheaper but less turnkey. Render is ill-fit. See `reports/strategy-2026-04.md` §Moat.

## Acceptance
- `treasury_standard` gains a `ComputeBond` PDA: `{provider, bond_usd, expires_at, slashable_until}`.
- Integration with io.net's lease API: on bond post, reserve matching GPU hours; on slash, reclaim compute allocation to protocol.
- Task_market checks `ComputeBond.is_active()` for bid eligibility on compute-heavy categories.
- Demo: agent posts $100 bond → accepts image-gen task → fails deadline → bond slashed to client.

## Steps
1. Talk to io.net partnerships (human step — flag for user).
2. `specs/compute-bond.md` covering both io.net + Akash fallback.
3. Anchor program changes.
4. Off-chain `services/compute-broker` for API glue.

## Verify
```
anchor test
pnpm --filter @saep/compute-broker test
```

## Log
