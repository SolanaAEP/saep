# Pre-audit 01 — typed task schema + outbound call whitelist

Parent: `backlog/P0_pre_audit_hardening.md` item 1.
Threat: prompt-injection / social-engineering of agents via free-form task descriptions + unrestricted treasury CPI targets. Audits will not catch logical-layer injection, so the protocol must constrain the surface before M1.

## On-chain changes

### task_market

Current state (`programs/task_market/src/state.rs:46`) stores only a `task_hash: [u8; 32]` — off-chain payload is opaque. That is the vector: any off-chain convention can be smuggled inside. Replace with a typed, length-capped, on-chain `TaskPayload`:

```rust
// Cap total on-chain payload to 1 KiB. Larger artifacts go via `criteria_root`
// (merkle-committed off-chain blob), not free-form bytes.
pub const MAX_PAYLOAD_ARGS: usize = 8;
pub const MAX_ARG_LEN: usize = 64;
pub const MAX_CRITERIA_LEN: usize = 128;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, InitSpace)]
pub enum TaskKind {
    SwapExact  { in_mint: Pubkey, out_mint: Pubkey, amount_in: u64, min_out: u64 },
    Transfer   { mint: Pubkey, to: Pubkey, amount: u64 },
    DataFetch  { url_hash: [u8; 32], expected_hash: [u8; 32] },
    Compute    { circuit_id: [u8; 32], public_inputs_hash: [u8; 32] },
    Generic    { capability_bit: u16, args_hash: [u8; 32] },
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, InitSpace)]
pub struct TaskPayload {
    pub kind: TaskKind,
    pub capability_bit: u16,
    #[max_len(MAX_CRITERIA_LEN)]
    pub criteria: Vec<u8>, // opaque, passed to proof_verifier — cap kills griefing
}
```

`TaskContract` gains `pub payload: TaskPayload`. `create_task` takes `TaskPayload` as arg, rejects payloads whose `capability_bit` is not advertised by the bidding agent in `capability_registry`.

`task_hash` is recomputed deterministically from `(task_id, keccak(borsh(payload)))` so the ZK circuit can bind to the typed payload.

### treasury_standard

Add to `AgentTreasury` (see `programs/treasury_standard/src/state.rs:33`):

```rust
pub const MAX_CALL_TARGETS: usize = 32;

pub struct AllowedTargets {
    pub agent_did: [u8; 32],
    #[max_len(MAX_CALL_TARGETS)]
    pub targets: Vec<Pubkey>, // programs this treasury may CPI into
    pub bump: u8,
}
```

- New PDA `[b"allowed_targets", agent_did]`. Managed by the agent operator.
- Every outbound CPI from `treasury_standard` (existing: Jupiter swap; future: transfer hooks, streaming payouts) asserts `target_program in allowed_targets` before invoking.
- `TreasuryGlobal` keeps a global allow-list fallback for canonical programs (Jupiter, Token, Token-2022, AssociatedToken) so ops aren't blocked by empty per-agent lists during onboarding. Agent list overrides by presence.

## Instructions added

| ix | arg | effect |
|---|---|---|
| `task_market::create_task` | now takes `payload: TaskPayload` | store typed payload, bind `task_hash` to it |
| `treasury_standard::init_allowed_targets` | `targets: Vec<Pubkey>` | init PDA |
| `treasury_standard::update_allowed_targets` | `add: Vec<Pubkey>, remove: Vec<Pubkey>` | mutate, bounded length |
| `treasury_standard::cpi_guard_check` (internal helper) | `program_id: &Pubkey` | assert in list, used before every CPI |

## Events

- `TaskPayloadStored { task_id, kind_discriminant, capability_bit }`
- `AllowedTargetsUpdated { agent_did, added_count, removed_count }`

## Invariants (covered in `#[cfg(test)]`)

1. `create_task` with payload whose `capability_bit` not in agent's `CapabilityAccount.bits` → `UnknownCapability`.
2. `create_task` with `criteria.len() > MAX_CRITERIA_LEN` → rejected at borsh-deserialize by `#[max_len]`.
3. Jupiter CPI from a treasury whose `allowed_targets` doesn't contain the jupiter program id → `TargetNotAllowed`.
4. Global fallback honored: empty per-agent list + target ∈ global → allowed.
5. `allowed_targets.len() > MAX_CALL_TARGETS` → rejected on mutation.
6. `task_hash` in storage equals `keccak(task_id || keccak(borsh(payload)))` so ZK circuit can recompute.

## Non-goals this spec

- Outbound HTTP whitelisting — lives in `services/iacp` + agent runtime, separate spec.
- Prompt scrubbing — agent-side, not protocol-side.
- Token-2022 hook whitelist — separate spec (pre-audit 05).

## Migration

Pre-M1, no live data. No migration. `TaskContract` layout change is free.

## Verify

```
cargo test -p task_market --features test-bpf
cargo test -p treasury_standard --features test-bpf
anchor test
```
