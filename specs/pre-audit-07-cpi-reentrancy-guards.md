# Pre-audit 07 — CPI depth caps + reentrancy guards

Parent: `backlog/P0_pre_audit_hardening.md` item 7.
Threat: Solana doesn't prevent cross-program reentrancy the way EVM opcodes do — a callee program can CPI back into the caller mid-instruction. SAEP's forward CPI chain (`task_market` → `treasury_standard` → `fee_collector`) is benign, but any back-edge (fee_collector CPI'ing task_market, or treasury_standard CPI'ing task_market) is an exploit vector. Audits catch specific bugs; the *policy* must be encoded so adding a new CPI edge later does not silently open a cycle.

## Policy

1. CPI graph is a strict DAG, hard-coded in the reviewer-visible constant below.
2. Every state-changing ix that initiates CPI enters a per-program `reentrancy_guard`; callees assert the caller's guard is **set** (caller is inside a known ix) AND the callee's own guard is **unset** (callee is not already executing a CPI on its own stack).

### Allowed edges (only these)

```
task_market           → agent_registry       (read + update_reputation via proof_verifier)
task_market           → capability_registry  (read)
task_market           → proof_verifier       (verify)
task_market           → treasury_standard    (escrow transfers)
task_market           → fee_collector        (fee routing)
treasury_standard     → jupiter_program      (swap only)
treasury_standard     → token_program        (transfers)
treasury_standard     → fee_collector        (streaming fee accrual)
fee_collector         → token_program        (fee claim)
proof_verifier        → agent_registry       (update_reputation)
dispute_arbitration   → agent_registry       (slash)
dispute_arbitration   → task_market          (resolve)
dispute_arbitration   → treasury_standard    (escrow move)
governance_program    → * (admin-only set ix; not settlement-path)
```

No back-edges. No SAEP→SAEP cycles. Governance is never a callee of another SAEP program.

Enforcement: test in reviewer checklist. No runtime graph check (CU-expensive); we pin the graph in code via compile-time whitelist per callee.

## Guard mechanism

Each SAEP program gains a `ReentrancyGuard` PDA:

```rust
#[account]
#[derive(InitSpace)]
pub struct ReentrancyGuard {
    pub active: bool,
    pub entered_by: Pubkey,     // program_id of caller, or self for top-level
    pub entered_at_slot: u64,   // for forensic logs
    pub bump: u8,
}
```

PDA: `[b"guard"]` — one per program.

### Top-level entry pattern

```rust
pub fn enter_guard(guard: &mut Account<ReentrancyGuard>, caller: Pubkey, slot: u64) -> Result<()> {
    require!(!guard.active, ErrorCode::ReentrancyDetected);
    guard.active = true;
    guard.entered_by = caller;
    guard.entered_at_slot = slot;
    Ok(())
}

pub fn exit_guard(guard: &mut Account<ReentrancyGuard>) {
    guard.active = false;
    guard.entered_by = Pubkey::default();
}
```

### Callee whitelist pattern

Each callee ix that is reachable via CPI validates:

```rust
// In e.g. treasury_standard::transfer_from_escrow (called by task_market)
let caller_program = instruction::get_stack_height() > 1
    ? instruction::get_processed_sibling_instruction(...)  // or sysvar::instructions parse
    : *ctx.program_id;

require!(
    ALLOWED_CALLERS.contains(&caller_program),
    TreasuryError::UnauthorizedCaller
);
require!(
    ctx.accounts.caller_guard.active,    // caller must be mid-ix
    TreasuryError::CallerGuardNotActive
);
require!(
    !ctx.accounts.self_guard.active,     // we must not already be on the stack
    TreasuryError::ReentrancyDetected
);
```

`ALLOWED_CALLERS` is a `const &[Pubkey]` per callee, populated from `MarketGlobal`/`TreasuryGlobal` at account-validation time (not hardcoded base58 — we pass the config account in).

### CPI depth cap

Anchor/Solana hard caps CPI depth at 4 already. We additionally assert `instruction::get_stack_height() <= 3` at every callee entry — prevents anyone from chaining us via a malicious 4-deep path and dropping our CU budget.

## Enforcement points (instruction-by-instruction)

| program | ix that acquire guard | ix that assert callee pattern |
|---|---|---|
| task_market | fund_task, release, refund, submit_result, close_bidding, resolve_from_dispute | — (top-level originator) |
| treasury_standard | stream_withdraw, swap_via_jupiter | transfer_from_escrow, fee_accrue |
| fee_collector | — | collect_fee, distribute |
| agent_registry | register_agent, stake, unstake | update_reputation, slash |
| proof_verifier | (none; always a callee) | verify, verify_and_update_reputation |
| dispute_arbitration | raise_dispute, vote, resolve | — (top-level originator) |
| capability_registry | propose_tag, update_manifest_uri, retire_tag | — (currently leaf, no guard needed) |

## Invariants (unit-test coverage required pre-audit)

1. Calling a callee ix without a live caller-guard → `CallerGuardNotActive`.
2. Calling a callee ix from a non-whitelisted program → `UnauthorizedCaller`.
3. Attempting reentrancy: task_market → treasury_standard → (mock) task_market callback → `ReentrancyDetected`.
4. Guard left active after ix abort: not possible because Anchor reverts account writes on error; assert in tests.
5. CPI depth ≥ 4 → `CpiDepthExceeded`.
6. Guard PDA writer authority = program only (not operator/admin). Separate ix `admin_reset_guard` gated by governance + 24h timelock for emergencies.

## Events

- `GuardEntered { program, caller, slot, stack_height }` (sampled, not per-tx — too noisy; emit on unusual callers)
- `ReentrancyRejected { program, offending_caller, slot }`

## Non-goals

- Dynamic graph introspection on-chain. Static whitelist is cheaper and audit-visible.
- Guard PDAs for capability_registry leaf ix — leaf, no CPI downstream, no guard needed.

## Verify

```
cargo test -p task_market reentrancy_ cpi_depth_
cargo test -p treasury_standard caller_guard_
cargo test -p proof_verifier unauthorized_caller_
anchor test tests/reentrancy_crossprogram.ts  # spawns a mock malicious callee
```

## Open questions

- `get_processed_sibling_instruction` requires the `sysvar::instructions` account passed in every ix. Confirm all callee ix already include it; if not, add in this pass. Fine to bloat accounts — auditors prefer explicit.
- Emergency guard reset timelock: 24h is conservative. Governance can override with 2/3 vote + 48h — explicitly slower, not faster, than normal timelock. Captured in `governance_program` spec addendum.
