# Spec — FeeCollector Program

**Owner:** anchor-engineer
**Depends on:** SAEP Token-2022 mint with TransferFee + TransferHook + PermanentDelegate + Pausable extensions (M3 spec — FeeCollector deploys pre-mint on devnet against a placeholder Token-2022 mint and is rewired to the real mint at M3 via meta-governance); NXSStaking (staker-share distribution consumer + slash-intake source); GovernanceProgram (TreasurySpend executor + param authority); Squads multisig v4 (6-of-9 meta-governance for grant-pool payouts + authority handover; 4-of-7 program council for upgrades).
**Blocks:** M3 SAEP mint bootstrap (TransferHook callback + PermanentDelegate delegate both resolve to a program PDA; mint init cannot commit the extension fields until the PDA addresses are known); M2 GovernanceProgram TreasurySpend execution path (program_registry entry depends on FeeCollector being live); NXSStaking staker-rewards crank (pulls from FeeCollector's staker pool); AgentRegistry / DisputeArbitration / GovernanceProgram slash-destination consumers (all CPI into FeeCollector's slash-intake vault).
**References:** backend PDF §1.3 (FeeCollector owns TransferFee withdrawal authority + PermanentDelegate after mint handover + TransferHook callback program; burn / staker-share / grant-share / treasury split governance-set; Pausable Phase 3 emergency council 4-of-7), §2.1 (CU targets — `process_epoch` 80k / `claim_staker` 20k / `execute_burn` 30k / `collect_fees` 40k), §2.6 (deployment + upgrade table — 7d standard timelock; Squads 4-of-7 authority), §4.3 (deploy order — FeeCollector lands after CapabilityRegistry + GovernanceCore, before AgentRegistry so slash rails can name the program; 48h devnet timelock at init), §5.1 (Security checklist: re-entrancy on harvest → distribution pipeline, Token-2022 extension safety for TransferHook / TransferFee / PermanentDelegate, distribution-math integer overflow, burn irreversibility, authorization boundaries for hook-allowlist vs governance vs upgrade authorities), §5.2 (multisig 4-of-7 + 6-of-9 split + signer geo-distribution + HSM).

## Goal

The single fee + slash sink for SAEP. Token-2022 `TransferFee` withdrawals from the SAEP mint funnel here via `harvest_withheld_tokens_to_mint` + `withdraw_withheld_tokens_from_mint` (both CPI'd from this program, signed by the TransferFee authority PDA which this program owns). The program also passively receives slash tokens from NXSStaking / AgentRegistry / DisputeArbitration (`transfer_checked` to the slash-intake ATA) and forfeit proposer collateral from GovernanceProgram.

Accumulated tokens are partitioned per epoch across four sinks per §1.3:
- **Burn** (default 1000 bps / 10%) — CPI'd via Token-2022 `burn_checked` signed by the PermanentDelegate PDA; SAEP mint authority is `None` post-handover, so PermanentDelegate is the only legal burn path.
- **Staker share** (default 5000 bps / 50%) — routed to the per-epoch staker distribution vault. Off-chain cranker computes per-staker claim entitlements against the NXSStaking snapshot at `epoch_snapshot_id`, commits a merkle root via `commit_distribution_root`, stakers pull via `claim_staker` with a merkle inclusion proof.
- **Grant share** (default 2000 bps / 20%) — routed to the grant-pool ATA; outflow is meta-governance only (Squads 6-of-9 + GovernanceProgram `TreasurySpend` CPI, whichever the grant governs).
- **Protocol treasury** (default 2000 bps / 20%) — routed to the treasury ATA; outflow is GovernanceProgram `TreasurySpend` CPI (standard 7d timelock).

The bps quadruple MUST sum to `10_000` exactly at every `set_distribution_params` write. Revised defaults land via GovernanceProgram CPI; the 4-of-7 program council can only set the 10% per-bucket hard ceilings and the authority routing.

FeeCollector also exposes the SPL `TransferHookInterface::execute` callback. The hook is advisory-only at M2 (it asserts the mint / source / destination owner types and returns Ok — no burn / freeze / deny inside the hook, which would violate Token-2022's "hook cannot fail except for structural reasons" contract). Rate-limit / compliance hooks are flagged as M4+ post-audit.

Every transition is signed, seeded, event-logged, and TransferHook-aware so the indexer can replay any fee / slash / distribution event deterministically and the portal can surface live fee accrual + per-staker claims.

## State

### `FeeCollectorConfig` PDA — singleton
- **Seeds:** `[b"fee_config"]`
- **Fields:**
  - `authority: Pubkey` — Squads 4-of-7 program council (per §2.6); param routing + authority handover
  - `meta_authority: Pubkey` — Squads 6-of-9 meta-governance; adjusts distribution bps + bucket hard ceilings
  - `governance_program: Pubkey` — GovernanceProgram CPI identity (TreasurySpend executor + params when routed via governance)
  - `nxs_staking: Pubkey` — NXSStaking CPI identity (snapshot-root lookup for staker-share weights; slash source)
  - `agent_registry: Pubkey` — AgentRegistry CPI identity (slash source; proposer-collateral forfeit destination)
  - `dispute_arbitration: Pubkey` — DisputeArbitration CPI identity (slash source)
  - `emergency_council: Pubkey` — Squads 4-of-7 (per §1.3 Pausable extension authority; invokes `set_paused`)
  - `saep_mint: Pubkey` — Token-2022 SAEP mint (TransferFee + TransferHook + PermanentDelegate + Pausable)
  - `transfer_fee_authority: Pubkey` — TransferFee withdrawal authority PDA `[b"fee_auth"]`; set on the mint at init (M3)
  - `permanent_delegate: Pubkey` — PermanentDelegate PDA `[b"perm_delegate"]`; set on the mint at init (M3)
  - `hook_authority: Pubkey` — TransferHook program authority; not a delegate — only exists to route the advisory hook execution
  - `burn_bps: u16` — default 1000 (10%)
  - `staker_share_bps: u16` — default 5000 (50%)
  - `grant_share_bps: u16` — default 2000 (20%)
  - `treasury_share_bps: u16` — default 2000 (20%)
  - `burn_cap_bps: u16` — 2000 (hard ceiling; meta-governance only)
  - `staker_cap_bps: u16` — 7500 (hard ceiling; meta-governance only)
  - `grant_cap_bps: u16` — 3000 (hard ceiling; meta-governance only)
  - `treasury_cap_bps: u16` — 3000 (hard ceiling; meta-governance only)
  - `epoch_duration_secs: i64` — default `7 * 86400` (1 week); tunable by governance
  - `next_epoch_id: u64` — monotonic epoch counter; bumped by `process_epoch`
  - `claim_window_secs: i64` — default `90 * 86400` (90 days) — unclaimed staker-share rolls into the next epoch's staker pool via `sweep_stale_epoch`
  - `min_epoch_total_for_burn: u64` — default `10_000 * 10^decimals`; epochs below threshold skip `execute_burn` and roll the bucket (burns are irreversible; below-threshold burns waste CU without moving the inflation needle)
  - `grant_recipient: Pubkey` — grant-pool ATA receiver (governance-set; default = meta_authority-owned ATA); outflow from this ATA is outside this program
  - `treasury_recipient: Pubkey` — protocol-treasury ATA receiver (governance-set; default = governance_program-owned ATA)
  - `paused: bool` — blocks `process_epoch` / `claim_staker` / `execute_burn` / `collect_fees`; slash-intake stays open (cannot trap value during a pause); hook allowlist ops continue
  - `bump: u8`

### `EpochAccount` PDA — per epoch
- **Seeds:** `[b"epoch", epoch_id.to_le_bytes()]`
- **Fields:**
  - `epoch_id: u64`
  - `started_at_slot: u64`
  - `started_at_ts: i64`
  - `closed_at_slot: Option<u64>`
  - `closed_at_ts: Option<i64>`
  - `snapshot_id: u64` — NXSStaking snapshot captured at `process_epoch` close (for staker-share weight)
  - `total_collected: u64` — sum of fees harvested + slashes received + collateral forfeited into this epoch's pre-split pool
  - `burn_amount: u64` — computed at `process_epoch`; committed on `execute_burn`
  - `burn_executed: bool`
  - `staker_amount: u64` — committed to epoch's staker pool at `process_epoch`
  - `staker_distribution_root: [u8; 32]` — committed via `commit_distribution_root`
  - `staker_distribution_committed: bool`
  - `staker_claimed_total: u64` — sum of claimed principal across this epoch's `claim_staker` calls; bounded by `staker_amount`
  - `grant_amount: u64` — transferred on `process_epoch` to `grant_recipient`
  - `treasury_amount: u64` — transferred on `process_epoch` to `treasury_recipient`
  - `stale_swept: bool` — set when `sweep_stale_epoch` rolls residuals forward
  - `bump: u8`

  The 4 `*_amount` fields MUST sum to `total_collected` — no dust, no rounding drift. Dust from bps split (at most 3 units per epoch across 4 buckets) lands in `treasury_amount` per the invariant.

### `StakerClaim` PDA — per `(epoch_id, staker)`
- **Seeds:** `[b"claim", epoch_id.to_le_bytes(), staker.as_ref()]`
- **Fields:**
  - `epoch_id: u64`
  - `staker: Pubkey`
  - `amount_claimed: u64` — equals the merkle-leaf amount on successful claim
  - `claimed_at_slot: u64`
  - `bump: u8`

  Existence of this PDA prevents double-claim (Anchor `init` at claim-time fails on replay). Rent reclaimed on `sweep_stale_epoch` post-claim-window.

### `IntakeVault` — Token-2022 ATA owned by `[b"intake_vault"]` PDA
- **Seeds:** `[b"intake_vault"]` (the PDA; the ATA is then its associated token account for `saep_mint`)
- **Purpose:** single inbound sink for harvested TransferFees + slashes + proposer-collateral forfeits. `process_epoch` sweeps this vault's balance into the 4 outbound vaults in a single atomic instruction. Slashers and forfeiters `transfer_checked` directly into this ATA.

### `BurnVault` — Token-2022 ATA owned by `[b"burn_vault"]` PDA
- **Seeds:** `[b"burn_vault"]`
- **Purpose:** staging ATA for the burn bucket. `process_epoch` moves `burn_amount` here; `execute_burn` CPIs `burn_checked` signed by the PermanentDelegate PDA against this ATA.

### `StakerVault` — Token-2022 ATA owned by `[b"staker_vault"]` PDA
- **Seeds:** `[b"staker_vault"]`
- **Purpose:** staging ATA for the staker-share bucket. `claim_staker` transfers from this ATA to the staker's ATA, signed by the PDA.

### `ReentrancyGuard` (program-global, scaffolded)
- Standard pattern from `programs/agent_registry/src/guard.rs`. Inbound-CPI guard on `record_slash_receipt` + `record_collateral_forfeit` (callers must be the registered AgentRegistry / DisputeArbitration / GovernanceProgram / NXSStaking; caller-side guard must be active; FeeCollector's guard must be inactive pre-entry). Outbound-CPI guard on `process_epoch` (the big fan-out: 3 × `transfer_checked` + 1 × `transfer` to staker vault) and `execute_burn` (CPI to Token-2022 `burn_checked`).

### `HookAllowlist` / `AgentHookAllowlist` / call-site ids — existing scaffold
- Scaffolded per F-2026-05 + F-2026-06 (see `programs/fee_collector/src/{state,hook,instructions/*}.rs`). Not re-described here; the spec ratifies the existing shape: 16-pubkey global list + 4-pubkey per-agent override + 12 call-site ids on the TaskMarket / TreasuryStandard side, `assert_hook_allowed_at_site` emits `HookRejected` with the site id so the indexer can bucket rejections. This subsystem is orthogonal to the distribution pipeline — kept under the same program because both share the "inspects the SAEP mint extensions at runtime" semantics and the TransferHook callback lives here. Migration to a dedicated `hook_guard` program is a post-audit decision (Open Question).

## Enums

```
enum EpochStatus {
    Open,                // intake vault accrues; process_epoch not yet called
    Splitting,           // process_epoch committed bucket amounts; grant + treasury moved; burn + staker vaults hold residual
    DistributionCommitted, // staker root committed; claim_staker open
    Stale,               // claim window elapsed; residuals swept to next epoch's intake
}
```

`Open → Splitting` via `process_epoch`. `Splitting → DistributionCommitted` via `commit_distribution_root` (only applies to the staker bucket — grant + treasury + burn all completed at `process_epoch` close, modulo `execute_burn` which is a separate on-chain irreversibility gate). `DistributionCommitted → Stale` via `sweep_stale_epoch` once `claim_window_secs` elapses.

## State machine

```
  collect_fees (permissionless crank, harvests TransferFee → intake_vault)
  record_slash_receipt (CPI, transfer_checked → intake_vault)     accrue
  record_collateral_forfeit (CPI, transfer_checked → intake_vault)   |
                                                                      v
                                                                   [Open]
                                                                      |
                                                              process_epoch
                                                                      |
                                                                      v
                                                                [Splitting]
                                                                      |
                                                     +----------------+---------------+
                                                     |                                |
                                             commit_distribution_root          execute_burn
                                                     |                                |
                                                     v                                v
                                        [DistributionCommitted]                (bucket closed)
                                                     |
                                              claim_staker × N
                                                     |
                                     (claim_window_secs elapses)
                                                     |
                                              sweep_stale_epoch
                                                     |
                                                     v
                                                  [Stale]
```

`process_epoch` must precede both `commit_distribution_root` and `execute_burn`. The two follow-ups are independent — burn can happen before or after the distribution root is committed. `claim_staker` requires `DistributionCommitted`. `sweep_stale_epoch` rolls the unclaimed staker residual plus any un-burned `burn_amount` (if `execute_burn` was never called — below `min_epoch_total_for_burn` or operator neglect) into `EpochAccount { epoch_id + 1 }.intake_vault` as a bookkeeping top-up.

## Instructions

### `init_config(authority, meta_authority, governance_program, nxs_staking, agent_registry, dispute_arbitration, emergency_council, saep_mint, grant_recipient, treasury_recipient, params)` — one-shot, deployer
- **Validation:** singleton — fails if `FeeCollectorConfig` exists. `params` must satisfy `burn_bps + staker_share_bps + grant_share_bps + treasury_share_bps == 10_000` and each ≤ its respective cap. Mint hard-pin: fails if `saep_mint`'s mint authority is not `None` (M3 handover must be complete — or on devnet, matches the placeholder mint authority).
- **Effect:** initializes `FeeCollectorConfig`. Creates `transfer_fee_authority`, `permanent_delegate`, `hook_authority`, `intake_vault`, `burn_vault`, `staker_vault` PDAs + their ATAs for `saep_mint`. Creates `EpochAccount { epoch_id: 0, status: Open }`. Does NOT write the mint extensions (those are set at mint-init time by the M3 bootstrap script; init_config verifies the PDA identities match).
- **Emits:** `FeeCollectorInitialized`
- **CU target:** 80k

### `collect_fees(mint_holders: Vec<Pubkey>)` — permissionless crank, up to 10 holders per call
- **Validation:** `!config.paused`. `mint_holders.len() <= 10` (CU bound). Each holder is a Token-2022 account with `saep_mint` and non-zero `withheld_amount`.
- **Effect:** CPIs Token-2022 `harvest_withheld_tokens_to_mint` against the holder ATAs, then `withdraw_withheld_tokens_from_mint` from the mint to `intake_vault`. Signed by `transfer_fee_authority` PDA. Increments `current_epoch.total_collected` by the harvested amount.
- **Emits:** `FeesCollected { epoch_id, amount, collector }`
- **CU target:** 40k + 10k × len(mint_holders)

### `record_slash_receipt(amount)` — CPI-only
- **Signers:** caller program (one of `nxs_staking`, `agent_registry`, `dispute_arbitration`; identity hard-pinned from `FeeCollectorConfig`)
- **Validation:** `ReentrancyGuard.check_callee_preconditions`: caller's guard active, FeeCollector's guard inactive pre-entry. Caller has already moved `amount` into `intake_vault` via `transfer_checked` — this ix is the accounting-only receipt; token movement pre-ix is validated by balance-delta of `intake_vault`.
- **Effect:** increments `current_epoch.total_collected` by `amount`. Emits a typed receipt so the indexer can classify this inflow as a slash vs regular fee (slashes and fees are fungible post-split but the indexer surfaces the provenance on the portal).
- **Emits:** `SlashReceived { epoch_id, slasher_program, amount }`

### `record_collateral_forfeit(amount)` — CPI-only
- **Signers:** `governance_program` (proposer-collateral path) OR `agent_registry` (deposit-forfeit path)
- **Validation / Effect / Emits:** same shape as `record_slash_receipt`, different event type.
- **Emits:** `CollateralForfeited { epoch_id, source_program, amount }`

### `process_epoch()` — permissionless crank
- **Validation:**
  - `!config.paused`.
  - `EpochAccount { epoch_id: current }.status == Open`.
  - `now_ts >= current_epoch.started_at_ts + config.epoch_duration_secs`.
  - `intake_vault.amount == current_epoch.total_collected` (accounting parity check; prevents silent drift).
- **Effect (state-before-CPI per §5.1):**
  - Sets `status = Splitting`, `closed_at_slot`, `closed_at_ts`.
  - Computes bucket amounts from `total_collected` and the bps quadruple. Dust (`total_collected - sum(buckets)` ∈ `{0..3}`) lands in `treasury_amount`.
  - Writes `burn_amount` / `staker_amount` / `grant_amount` / `treasury_amount` to the `EpochAccount`.
  - Captures `snapshot_id = nxs_staking.latest_committed_snapshot` (read via CPI view — the snapshot_id is a stable referent, freshness is enforced at `claim_staker` time).
  - CPIs: `transfer_checked` intake → burn_vault (`burn_amount`), intake → staker_vault (`staker_amount`), intake → `grant_recipient` (`grant_amount`), intake → `treasury_recipient` (`treasury_amount`). 4 CPIs in deterministic order; balances-before/after assertion post-CPI.
  - Initializes `EpochAccount { epoch_id: current + 1, status: Open }`.
  - Increments `config.next_epoch_id`.
- **Emits:** `EpochProcessed { epoch_id, total_collected, burn_amount, staker_amount, grant_amount, treasury_amount, snapshot_id }`
- **CU target:** 80k

### `commit_distribution_root(epoch_id, root, leaf_count, total_weight)` — permissionless cranker
- **Validation:**
  - `epoch.status == Splitting`.
  - `leaf_count * average_claim ≈ staker_amount` — this is NOT on-chain; verified off-chain. The on-chain check is `total_weight == leaf_sum(amount)` — anyone can compute and commit; the first successful commit wins; subsequent commits fail because `staker_distribution_committed == true`.
  - `now_ts < epoch.closed_at_ts + 2 * 86400` (2-day window; after this the epoch rolls as Stale and the staker bucket goes into the next epoch — preserves liveness if the cranker is unavailable).
- **Effect:** writes `staker_distribution_root = root`, `staker_distribution_committed = true`, `status = DistributionCommitted`.
- **Emits:** `DistributionRootCommitted { epoch_id, root, leaf_count, total_weight, committer }`
- **CU target:** 25k

### `claim_staker(epoch_id, amount, merkle_proof)` — staker-signed
- **Signers:** `staker`
- **Validation:**
  - `epoch.status == DistributionCommitted`.
  - `now_ts < epoch.closed_at_ts + config.claim_window_secs`.
  - Merkle proof of `(staker, amount)` against `epoch.staker_distribution_root`.
  - `StakerClaim { epoch_id, staker }` PDA does not exist (first claim wins; Anchor `init` enforces).
  - `epoch.staker_claimed_total + amount <= epoch.staker_amount` (prevents over-withdrawal against a malformed root).
- **Effect:** initializes `StakerClaim`. Increments `epoch.staker_claimed_total`. CPIs `transfer_checked` from `staker_vault` to staker's ATA.
- **Emits:** `StakerClaimed { epoch_id, staker, amount }`
- **CU target:** 20k + 1k × proof_depth (max 24)

### `execute_burn(epoch_id)` — permissionless crank
- **Validation:**
  - `epoch.status ∈ {Splitting, DistributionCommitted, Stale}`.
  - `!epoch.burn_executed`.
  - `epoch.total_collected >= config.min_epoch_total_for_burn` (below-threshold burns skipped; burn_amount rolls via sweep).
- **Effect:** ReentrancyGuard outbound-CPI. Sets `epoch.burn_executed = true` (state-before-CPI). CPIs Token-2022 `burn_checked` signed by `permanent_delegate` PDA against `burn_vault` for `epoch.burn_amount`. Asserts post-CPI that `burn_vault.amount == prior - burn_amount`.
- **Emits:** `BurnExecuted { epoch_id, amount, crank }`
- **CU target:** 30k

### `sweep_stale_epoch(epoch_id)` — permissionless crank
- **Validation:**
  - `epoch.status ∈ {Splitting, DistributionCommitted}`.
  - `now_ts >= epoch.closed_at_ts + config.claim_window_secs + 7 * 86400` (7-day grace after the claim window closes).
  - `!epoch.stale_swept`.
- **Effect:** computes `residual_staker = staker_amount - staker_claimed_total`, `residual_burn = burn_executed ? 0 : burn_amount`. CPIs `transfer_checked` from `staker_vault` + (conditionally) `burn_vault` to `intake_vault`. Credits `EpochAccount { epoch_id: epoch_id + 1 }.total_collected` by the swept amount. Sets `status = Stale`, `stale_swept = true`.
- **Emits:** `EpochSwept { epoch_id, residual_staker, residual_burn, rolled_to_epoch }`
- **CU target:** 40k

### `gc_staker_claims(epoch_id, claim_accounts: Vec<Pubkey>)` — permissionless crank
- **Validation:** `epoch.status == Stale`. `now_ts >= epoch.closed_at_ts + config.claim_window_secs + 30 * 86400`. `claim_accounts.len() <= 10`.
- **Effect:** closes up to 10 `StakerClaim` PDAs per call; rent reclaimed to the caller. Pure cleanup; no token movement.

### `set_distribution_params(burn_bps, staker_share_bps, grant_share_bps, treasury_share_bps)`
- **Signers:** `meta_authority` CPI (Squads 6-of-9 via GovernanceProgram `execute_proposal` when the proposal category is `ParameterChange` targeting FeeCollector AND the subkind is distribution-split)
- **Validation:** sum == 10_000. Each ≤ its cap (`burn_cap_bps` / `staker_cap_bps` / `grant_cap_bps` / `treasury_cap_bps`). Reentrancy-guard active for inbound CPI.
- **Effect:** writes the new quadruple. Effective on the next epoch (current epoch's split already committed at `process_epoch`, so a change mid-epoch cannot retroactively redistribute).
- **Emits:** `DistributionParamsUpdated`
- **CU target:** 20k

### `set_params(params)`
- **Signers:** `governance_program` CPI (ParameterChange, subkind non-distribution — `epoch_duration_secs`, `claim_window_secs`, `min_epoch_total_for_burn`, `grant_recipient`, `treasury_recipient`)
- **Validation:** caller = governance_program. Per-field bounds: `epoch_duration_secs ∈ [86400, 30 * 86400]`, `claim_window_secs ∈ [7 * 86400, 365 * 86400]`, `min_epoch_total_for_burn` non-zero. Recipient ATAs validated against `saep_mint`.
- **Emits:** `ParamsUpdated`

### `set_bucket_caps(burn_cap_bps, staker_cap_bps, grant_cap_bps, treasury_cap_bps)`
- **Signers:** `meta_authority` CPI only (Squads 6-of-9 + GovernanceProgram meta-governance 21d timelock)
- **Validation:** each cap ∈ `[current_bps, 10_000]` — caps can only widen, never narrow (narrowing below an active bps is a cross-config invariant violation); overall sum of caps ≤ `40_000` (any allocation remains valid under the caps); reentrancy-guard active.
- **Emits:** `BucketCapsUpdated`

### `set_paused(paused: bool)`
- **Signers:** `authority` OR `emergency_council`
- **Effect:** flips `config.paused`. Blocks `collect_fees` / `process_epoch` / `commit_distribution_root` / `claim_staker` / `execute_burn` / `sweep_stale_epoch`. Slash-intake (`record_slash_receipt`) / forfeit (`record_collateral_forfeit`) / hook allowlist ops continue (cannot trap value during a pause, and the mint-level Pausable is orthogonal per §1.3).
- **Emits:** `PausedSet`

### `transfer_authority_two_step(new_authority)` / `accept_authority()`
- Standard two-step authority handover for `FeeCollectorConfig.authority` (Squads multisig migration). Mirrors the pattern used in `agent_registry` / `nxs_staking`.

### TransferHook callback — `execute(amount)`
- **Signers:** the Token-2022 program itself (as part of transfer-hook dispatch); `saep_mint` as the mint-identity anchor.
- **Validation:** `mint == config.saep_mint`. `source_token_account.owner` and `destination_token_account.owner` are both legitimate Token-2022 account types (not program-owned temporary accounts that could break post-transfer invariants). `amount > 0`. `!config.paused` — a Pausable-paused mint would reject at the Token-2022 layer first; this is belt-and-braces.
- **Effect:** no token movement, no state mutation. Advisory-only at M2 per the spec — the hook is a structural gate. Rate-limit / compliance / agent-scoped checks are flagged as M4+ post-audit (Open Question).
- **Emits:** none (hook instructions that emit events break some wallet clients that inspect the transfer's log output; kept silent).

### Hook allowlist + agent-hook allowlist + guard — existing scaffold
- `init_hook_allowlist`, `update_hook_allowlist`, `set_default_deny`, `transfer_hook_authority`, `accept_hook_authority`, `init_agent_hook_allowlist`, `update_agent_hook_allowlist`, `init_guard`, `set_allowed_callers`, `propose_guard_reset`, `admin_reset_guard` — see `programs/fee_collector/src/lib.rs`. Spec ratifies the existing shape per F-2026-05 / F-2026-06. Future M4+ hook-logic extensions live here.

## Events

Emitted at M1 (per `programs/fee_collector/src/events.rs` + `emit!` call sites): `FeeCollectorInitialized`, `SlashReceived`, `CollateralForfeited`, `EpochProcessed`, `DistributionRootCommitted`, `StakerClaimed`, `BurnExecuted`, `EpochSwept`, `DistributionParamsUpdated`, `PausedSet`, `HookRejected`, `HookAllowlistInitialized`, `HookAllowlistUpdated`, `AgentHookAllowlistUpdated`. (Forward-looking names `ParamsUpdated` / `BucketCapsUpdated` / `AuthorityTransferProposed` / `AuthorityAccepted` / `GuardCallersUpdated` / `GuardResetProposed` / `GuardResetExecuted` are reserved for M2 event-surface extensions tied to `set_bucket_caps` + `transfer_authority_two_step` + guard-callers admin ixs not yet scaffolded against dedicated event types — `set_params` currently emits `DistributionParamsUpdated` + `PausedSet` only.) Struct-defined but not yet `emit!`'d: `FeesCollected` / `MintAccepted` / `GuardEntered` / `ReentrancyRejected` — scaffold parity with other programs; wire-up lands when the matching ix surfaces extend.

Each epoch-scoped event carries `epoch_id` + `timestamp`. `SlashReceived` carries `slasher_program`; `CollateralForfeited` carries `source_program` — both populated from `FeeCollectorConfig`-hardpinned caller identity, not from the Accounts struct signer. Only `MintAccepted` / `GuardEntered` / `ReentrancyRejected` carry a `slot` field in the event body; indexer materializations resolve slot from the containing transaction for all other events.

## Errors

`Unauthorized`, `Paused`, `InvalidBpsSum`, `BucketCapExceeded`, `CapCannotNarrow`, `EpochNotOpen`, `EpochNotElapsed`, `IntakeAccountingDrift`, `EpochAlreadyProcessed`, `DistributionAlreadyCommitted`, `DistributionWindowElapsed`, `MerkleProofInvalid`, `ClaimAlreadyExists`, `ClaimOverflow`, `ClaimWindowElapsed`, `BurnBelowThreshold`, `BurnAlreadyExecuted`, `SweepGraceNotElapsed`, `NotStale`, `InvalidEpochState`, `InvalidMint`, `MintAuthorityMustBeNone`, `InvalidPdaOwner`, `InvalidRecipientMint`, `CallerNotRegisteredSlasher`, `CallerNotGovernance`, `CallerNotMetaAuthority`, `ReentrancyDetected`, `CpiDepthExceeded`, `ArithmeticOverflow`, `HookNotAllowed`, `InvalidProgramId`, `HookAllowlistFull`, `MintParseFailed`. (Reentrancy / caller / CPI / hook errors reuse existing scaffold enum where present.)

## CU budget (§2.1 targets; reviewer may tighten)

| Instruction | Target |
|---|---|
| `init_config` | 80k |
| `collect_fees` | 40k + 10k × holders (max 10) |
| `record_slash_receipt` | 15k |
| `record_collateral_forfeit` | 15k |
| `process_epoch` | 80k (4 CPIs dominated) |
| `commit_distribution_root` | 25k |
| `claim_staker` | 20k + 1k × proof_depth (max 24) |
| `execute_burn` | 30k (CPI dominated) |
| `sweep_stale_epoch` | 40k |
| `gc_staker_claims` | 10k + 2k × accounts (max 10) |
| `set_distribution_params` | 20k |
| `set_params` | 15k |
| `set_bucket_caps` | 15k |
| `set_paused` | 10k |
| TransferHook `execute` | 5k (advisory; no state change) |

`process_epoch` is the hot path and the most CU-dense ix in the program; reviewer may push for splitting into `process_epoch_split` (amounts only) + `process_epoch_fan_out` (the 4 CPIs) if CU proves tight against the 200k compute-unit budget defaults. Splitting is functionally safe because the intermediate state (`Splitting` with zero CPIs executed) is an invariant-stable checkpoint.

## Invariants

1. `burn_bps + staker_share_bps + grant_share_bps + treasury_share_bps == 10_000` at every write. Enforced on every `set_distribution_params` + `init_config` + (on read) every `process_epoch`.
2. `burn_bps <= burn_cap_bps`; same for the 3 other buckets. Caps only widen; reverting below an active bps is rejected.
3. `burn_amount + staker_amount + grant_amount + treasury_amount == total_collected` per epoch. Dust ≤ 3 units/epoch lands in `treasury_amount`.
4. `intake_vault.amount == current_epoch.total_collected` before `process_epoch`. Asserted pre-split.
5. `staker_claimed_total <= staker_amount` per epoch. Enforced per claim.
6. `staker_claimed_total + sweep_residual_staker == staker_amount` after `sweep_stale_epoch`.
7. `burn_amount` is only subtracted from `burn_vault` via `burn_checked` from PermanentDelegate PDA; no other code path moves tokens out of `burn_vault`.
8. Burn is irreversible and accounted: `epoch.burn_executed == true ⇒ BurnExecuted event emitted with matching amount`. No path double-burns the same epoch.
9. `process_epoch` initializes `EpochAccount { epoch_id + 1, status: Open }` atomically with closing the current epoch; intake continues immediately into the new epoch.
10. `record_slash_receipt` + `record_collateral_forfeit` can only be CPI'd by registered slashers / governance / agent_registry; caller-program identity is hard-pinned from `FeeCollectorConfig` (not from the Accounts struct signer pubkey).
11. `TransferHook::execute` never fails except for structural reasons (wrong mint, zero amount, paused config). Rate-limit / compliance rejections are M4+.
12. `permanent_delegate` PDA is the only signer that can invoke `burn_checked` against `burn_vault`. Mint authority is `None` post-handover; no alternative burn path exists.
13. `set_bucket_caps` narrowing is rejected; caps only widen via meta-governance.

## Security checks (backend §5.1)

- **Account Validation:** Anchor seeds + bumps on `FeeCollectorConfig`, `EpochAccount`, `StakerClaim`, plus PDA-derived ATA owners for `intake_vault` / `burn_vault` / `staker_vault`. Discriminator enforced. CPI identities for GovernanceProgram / NXSStaking / AgentRegistry / DisputeArbitration / emergency_council all read from `FeeCollectorConfig` — hard equality, never caller-supplied. Mint identity hard-pinned at init; every `transfer_checked` + `harvest_withheld_tokens_to_mint` call validates the mint matches.
- **Re-entrancy:** inbound-CPI (`record_slash_receipt`, `record_collateral_forfeit`, `set_distribution_params`, `set_params`, `set_bucket_caps`) goes through `check_callee_preconditions` — caller's reentrancy flag must be active; FeeCollector's flag must be inactive pre-entry. Outbound-CPI (`process_epoch` with 4 fan-out transfers; `execute_burn` to the Token-2022 program; `claim_staker` transfer) sets state before the CPI and flips the guard so a malicious downstream upgrade cannot re-enter and double-credit or double-burn. `process_epoch`'s 4 CPIs go through a single guard scope — one entry/exit pair, not four — to amortize the CU cost.
- **Integer Safety:** `u64` for per-epoch amounts; the bps split computes `total * bps / 10_000` in u128 then narrows to u64 (`total_collected` max is u64, u64 × u16 overflows u64 at ~2^48 — u128 intermediate is mandatory). Dust-sink logic uses `checked_sub` on the remainder. `staker_claimed_total + amount <= staker_amount` via `checked_add` against the bound. `u128` not needed for `total_staked`-style cross-account sums — FeeCollector's max per-epoch exposure is bounded by the live NXS supply, comfortably inside u64.
- **Authorization:** `init_config` deployer-signed; `collect_fees` / `process_epoch` / `commit_distribution_root` / `execute_burn` / `sweep_stale_epoch` / `gc_staker_claims` permissionless (status- or time-gated); `claim_staker` staker-signed (merkle proof); `record_*` CPI-only from registered callers; `set_distribution_params` + `set_bucket_caps` meta-authority CPI; `set_params` governance CPI; `set_paused` authority OR emergency_council; `transfer_authority_two_step` / `accept_authority` two-step.
- **Token-2022 Extension Safety:** `transfer_checked` exclusively — no raw `transfer`. `burn_checked` for burns. `harvest_withheld_tokens_to_mint` + `withdraw_withheld_tokens_from_mint` for TransferFee intake, signed by the program-owned `transfer_fee_authority` PDA. `init_config` asserts the mint's mint authority is `None` (post-M3-handover invariant; pre-M3 on devnet the asserting path is toggled off via a `dev_mode_skip_mint_auth_check` bool — flagged in Open Questions).
- **Mint Extension Expectations:** `inspect_mint_extensions` runs at init and at every distribution checkpoint to detect drift. Specifically: TransferHook program id is `fee_collector`, PermanentDelegate delegate is `permanent_delegate` PDA, TransferFee authority is `transfer_fee_authority` PDA. Drift between the on-chain mint extension state and `FeeCollectorConfig`'s cached identities is rejected (hard fail) — prevents an attacker who somehow flipped the mint's hook to a sibling program from leveraging the config's cached pubkeys. See `hook.rs::inspect_mint_extensions`.
- **Slashing / Burn Safety:** `execute_burn` is state-before-CPI + reentrancy-guarded; burn is irreversible. Below-threshold epochs skip burn and sweep the bucket forward (no tiny-burn CU waste; no burn-by-inattention if the crank sits unused). `burn_cap_bps` hard ceiling 2000 (20%) per §1.3 ratification.
- **Distribution Safety:** merkle root is committed by a permissionless cranker; first-commit-wins. `commit_distribution_root` has a 2-day window after epoch close; past that, the staker bucket rolls to the next epoch's intake as Stale residual — preserves liveness against an absent cranker. Merkle proof depth bounded at 24 (matches NXSStaking snapshot depth). `staker_claimed_total <= staker_amount` enforced per claim prevents over-withdrawal against a malformed root; a dishonest cranker cannot drain the staker_vault beyond `staker_amount` even with a bad root.
- **Hook Safety:** advisory TransferHook `execute` — no state change, no token movement, no failure except structural. This is the Token-2022 contract ("hooks cannot fail except for structural reasons") at M2. M4+ hook logic lands as a separate ix family with its own invariants (Open Question).
- **Upgrade Safety:** Squads 4-of-7, 7-day standard timelock per §2.6. Meta-governance (Squads 6-of-9, 21d) for distribution-bps + bucket-cap changes.
- **Pause:** `config.paused` blocks fee-flow and distribution paths; slash-intake + hook allowlist ops continue so inbound value is never trapped and the hook fence remains operational during a pause. Mint-level Pausable is orthogonal; pausing the mint stops all SAEP transfers including the fee harvest itself (since harvest is a Token-2022 ix) — both layers are wired so the protocol can recover from either.
- **Jito bundle assumption:** `collect_fees` + `process_epoch` are individually atomic; no multi-tx bundle dependency. The M3 mint bootstrap ceremony bundles `init_config` + mint extension writes + authority handover into one Jito bundle (see `specs/token2022-saep-mint.md`) — this program's init_config runs atomically from the bundle's perspective.
- **DOS surface:** `collect_fees` bounded at 10 holders per call; `gc_staker_claims` bounded at 10 accounts per call; `process_epoch` has a fixed 4-CPI fan-out. `EpochAccount` proliferation is unbounded over time but reclaimable: `sweep_stale_epoch` sets the terminal status and `gc_staker_claims` reclaims claim-account rent; a future `gc_stale_epoch` (M3 ops) will reclaim `EpochAccount` rent itself once all downstream PDAs are gc'd.

## CPI contract surface

FeeCollector exposes 5 CPI targets to other SAEP programs + 1 external interface:

1. `record_slash_receipt(amount)` — called by `NXSStaking::execute_slash`, `AgentRegistry::execute_slash`, `DisputeArbitration::execute_slash`. Caller must be registered. Token movement happens before the CPI (caller `transfer_checked`s into `intake_vault`); this ix is the accounting receipt.
2. `record_collateral_forfeit(amount)` — called by `GovernanceProgram::finalize_proposal` (failed-without-quorum) or `AgentRegistry::forfeit_deposit` (M3). Same pattern as `record_slash_receipt`.
3. `set_distribution_params(bps_quadruple)` — called by `GovernanceProgram::execute_proposal` when category is `ParameterChange` / subkind=distribution. Caller = meta_authority (Squads 6-of-9).
4. `set_params(params)` — called by `GovernanceProgram::execute_proposal` when category is `ParameterChange` / subkind=ops.
5. `set_bucket_caps(caps_quadruple)` — called by `GovernanceProgram::execute_proposal` when category is meta-governance / subkind=bucket-caps.
6. **TransferHook `execute`** — Token-2022 program CPIs here on every SAEP transfer. External interface per the TransferHookInterface spec; not a SAEP-program-only surface.

Each CPI site on the caller side does NOT mirror FeeCollector state into its own PDAs (single source of truth). The `NXSStaking::execute_slash` → `transfer_checked` + `record_slash_receipt` pair is specifically a 2-step sequence (not one CPI) to preserve the `intake_vault.amount == sum(total_collected)` invariant that `process_epoch` relies on.

## Devnet bring-up notes (§4.3)

- Init runs the 48h `dev_mode_timelock_override_secs` shadow per §4.3. The override only EXTENDS the natural timelock (max of computed + override). Cannot shorten.
- Pre-M3, `saep_mint` points at a placeholder Token-2022 mint created at devnet bootstrap. The placeholder has TransferFee + TransferHook + PermanentDelegate extensions pre-configured against FeeCollector's PDA identities (so `init_config`'s drift check passes), but the mint authority may be non-None (tester-owned). A `dev_mode_skip_mint_auth_check: bool` field on `FeeCollectorConfig` gates the `MintAuthorityMustBeNone` assertion — toggled off on mainnet via meta-governance before the M3 real mint lands. (Open Question on whether the toggle is strictly necessary vs. spec'ing a distinct devnet-only mint-init path.)
- A devnet-only `force_close_epoch` ix is intentionally NOT included. Devnet epoch durations are real; bankrun warps the clock instead.
- Hook allowlist ops are devnet-open: the default allowlist seeds with no entries + `default_deny=false` so unknown hooks warn but don't block. M3 flips `default_deny=true` and seeds the allowlist with the known-good NXSStaking / AgentRegistry / etc. hooks (there are none at M2; TaskMarket's `transfer_checked` to the SAEP mint invokes FeeCollector's own hook, not a third-party one).

## Open questions for reviewer

- **4-bucket split ratios.** Defaults `1000 / 5000 / 2000 / 2000` bps sum to 10_000. Backend PDF §1.3 cites the first three (`burn_bps=1000`, `staker_share=5000`, `grant_bps=2000`); the remaining 2000 is the protocol-treasury bucket introduced in this spec. Reviewer may want (a) 3-bucket split with the 2000 bps folded into grant (7000 + stakers + burn), (b) the spec's 4-bucket split where treasury is distinct and governance-controlled, (c) an Appfact-operating bucket separate from both grant and treasury. Default: spec's 4-bucket split (treasury distinct, governance-controlled); reviewer may collapse.
- **Staker-share distribution mechanism.** Spec uses merkle-root claim (off-chain cranker commits root → stakers pull). Alternative: streaming distribution (per-staker `stream_credit` + `claim_stream`) that accrues linearly across the epoch. Merkle is cheaper on-chain and matches the governance spec's snapshot pattern; streaming is more staker-friendly but adds O(stakers) on-chain write amplification. Default: merkle; reviewer may push streaming for M4+.
- **Staker-share vs NXSStaking InterestBearing overlap.** NXSStaking's APY comes from the mint's InterestBearing extension (§1.3). The staker-share bucket here is a second, fee-funded yield stream. Reviewer may ask whether the two should be unified (fee revenue funds the InterestBearing accrual via meta-governance `set_apy` adjustments rather than a separate claim flow). Trade-off: InterestBearing is always-accruing and has no per-claim UX; merkle-claim rewards only stakers who claim (so lazy stakers subsidize active ones, which might be a feature). Default: keep as separate streams; flag for reviewer.
- **Epoch duration 1 week.** Shorter epochs = more frequent distributions but higher crank overhead; longer = less frequent but higher per-epoch amounts and bigger at-stake value if a cranker outage occurs. Reviewer may tighten to 3 days or widen to 14.
- **Burn bucket cap 20% vs 10% default.** Cap allows governance to 2x the burn bucket in a deflationary regime (economic tuning). Reviewer may push for a hard 10% permanent cap (burn is irreversible; conservative ceiling limits meta-governance blast radius).
- **`min_epoch_total_for_burn` threshold.** 10_000 tokens × 10^decimals is arbitrary. The point is avoiding micro-burns when a below-threshold epoch lands in an otherwise-busy week. Reviewer may prefer (a) always burn regardless of size, (b) size by % of supply rather than absolute, (c) no threshold + accept micro-burns as a Schelling point.
- **TransferHook advisory vs enforcing.** M2 hook is structural-only (no rate-limit / compliance). The flexibility is there (mint-extension drift check already runs at every epoch boundary), but enforcing hooks gate every transfer and any bug cascades to every SAEP holder. Reviewer may defer to M4+ or push for a minimal denylist at M3 (e.g., OFAC-sanctioned addresses). Default: M2 advisory; M4+ enforcing.
- **`dev_mode_skip_mint_auth_check` vs distinct init path.** Spec adds a devnet-only bool to skip the `MintAuthorityMustBeNone` assertion during bring-up. Alternative: a `init_config_devnet` ix that skips the assertion and a separate `init_config_mainnet` that asserts it, gated by deploy-time feature flags. Default: bool with meta-governance toggle-off gate; flag for reviewer.
- **Cranker incentives for `process_epoch` / `commit_distribution_root` / `execute_burn`.** Permissionless crank paths rely on *someone* calling. Options: (a) cranker gets 10 bps of the epoch as a reward, carved from the treasury bucket (introduces a 5th bucket); (b) Appfact operates the cranker as infrastructure and no incentive is needed; (c) cranker is `authority` only (not permissionless). Default: (b) for M2, (a) for M4+ once operational data exists to size the incentive.
- **Separate grant vs treasury recipients.** `grant_recipient` and `treasury_recipient` default to different Squads multisigs. Reviewer may simplify to a single multisig with governance-controlled outflow categorization (saves 2000 bps of indirection at the cost of losing the "grant spend is meta-gov-only" boundary). Default: separate.
- **Hook allowlist merger into a dedicated program.** The F-2026-05 scaffold landed in FeeCollector because both share the mint-extension-inspection primitive. A post-audit cycle may split `hook_guard` into its own program for cleaner ownership (TaskMarket / TreasuryStandard CPI into `hook_guard::assert_hook_allowed_at_site` instead of FeeCollector's). Default: keep merged for M2; split post-audit if OtterSec flags the coupling.

## Done-checklist

- [ ] Full state machine implemented; illegal transitions rejected
- [ ] `init_config` rejects non-summing bps, non-None mint authority (gated on `dev_mode_skip_mint_auth_check`), mismatched mint-extension identities
- [ ] `collect_fees` harvests up to 10 holders atomically; `transfer_fee_authority` PDA signs; intake accounting tight
- [ ] `process_epoch` rejects pre-duration; splits with dust-to-treasury; 4 fan-out CPIs in deterministic order; next epoch opened atomically
- [ ] `commit_distribution_root` first-write-wins; 2-day window enforced; leaf-sum invariant checked
- [ ] `claim_staker` rejects expired window / missing proof / double-claim / over-withdrawal; PDA seed correct
- [ ] `execute_burn` rejects below-threshold + already-executed; state-before-CPI; post-CPI balance assertion
- [ ] `sweep_stale_epoch` rolls residuals to next epoch; 7d grace after claim window
- [ ] `gc_staker_claims` cleans up claim PDAs post-grace
- [ ] `set_distribution_params` rejects non-summing / over-cap quadruple; meta-authority CPI only
- [ ] `set_params` per-field bounds enforced; governance-CPI only
- [ ] `set_bucket_caps` rejects narrowing; meta-authority CPI only
- [ ] `set_paused` blocks fee-flow paths; leaves slash-intake + hook ops open
- [ ] TransferHook `execute` rejects wrong mint / zero amount / paused; no state change, no token movement
- [ ] Reentrancy test: malicious slasher upgrade attempts re-entry on `record_slash_receipt` — rejected
- [ ] Reentrancy test: malicious Token-2022-program replacement attempts re-entry during `process_epoch` CPI fan-out — rejected (state-before-CPI defense)
- [ ] Token-2022 test: mint-extension drift (third party flips TransferHook program id) — `inspect_mint_extensions` detects and rejects at next checkpoint
- [ ] Token-2022 test: `burn_checked` from `permanent_delegate` PDA succeeds; mint-authority-signed burn fails (authority is None)
- [ ] Bankrun test: 7d epoch duration — process before 7d (rejected), warp to 7d (succeeds)
- [ ] Bankrun test: 90d claim window — claim within window (succeeds), after window (rejected)
- [ ] Bankrun test: 2d distribution-root commit window — commit within (succeeds), after (rejected; staker bucket rolls via sweep)
- [ ] Bankrun test: 30d `gc_staker_claims` grace — gc within (rejected), after (succeeds)
- [ ] Fuzz test: bps quadruple over `set_distribution_params` — every non-summing / over-cap input rejected
- [ ] Fuzz test: merkle proof depth 1..24, valid proofs accepted, off-by-one invalid proofs rejected
- [ ] Golden-path integration test (localnet): 10 fees collected → process_epoch → 3 stakers claim from 10-leaf merkle tree → burn executed → sweep 3 residual claims forward
- [ ] Slash-integration test: NXSStaking::execute_slash → transfer_checked → record_slash_receipt → epoch shows correct total_collected + provenance tag
- [ ] Proposer-collateral integration test: GovernanceProgram proposal fails without quorum → record_collateral_forfeit → epoch total up
- [ ] CU measurements per instruction in `reports/fee-collector-anchor.md`
- [ ] IDL at `target/idl/fee_collector.json`
- [ ] Security auditor pass (§5.1); findings closed
- [ ] Reviewer gate green; spec ready for Neodyme M2 queue
