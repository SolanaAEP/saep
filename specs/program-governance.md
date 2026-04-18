# Spec — GovernanceProgram

**Owner:** anchor-engineer
**Depends on:** NXSStaking (voting power source), CapabilityRegistry (tag updates), Squads multisig v4 (4-of-7 program council, 6-of-9 meta-governance), AgentRegistry / TreasuryStandard / TaskMarket / DisputeArbitration / FeeCollector / ProofVerifier (CPI execution targets).
**Blocks:** M2 unfreeze of any param-tunable surface across the 6 core programs; M2 ProgramUpgrade workflow; M2 CapabilityRegistry tag rotation; M2 frontend `/governance` and `/treasury` (TreasurySpend) flows; M3 SAEP mint InterestBearing APY updates per §1.3.
**References:** backend PDF §1.3 (FeeCollector params governance-set, InterestBearing APY governance-set, Pausable Phase 3 emergency council 4-of-7), §2.1 (CU targets — `propose` 40k / `vote` 20k / `execute` 80k; deps NXSStaking + FeeCollector), §2.6 (deployment + upgrade table — 7d standard / 14d critical-path / 21d meta-governance; Squads 4-of-7 standard, 6-of-9 GovernanceProgram self), §4.3 (deploy order: CapabilityRegistry → GovernanceCore → FeeCollector → AgentRegistry → TreasuryStandard → ProofVerifier → TaskMarket → DisputeArbitration; 48h devnet timelock at init), §5.1 (Security checklist: re-entrancy, authorization + emergency pause respected, slashing time-locked 30d, upgrade authorities all in Squads + on-chain timelock, oracle staleness/confidence — no oracle in this program but inherited via CPI targets), §5.2 (multisig 4-of-7 / 6-of-9 split + signer geo-distribution + HSM).

## Goal

The single on-chain governance plane for SAEP. Every parameter-tunable knob across the 6 core programs (§2.1) is updated via a `GovernanceProgram::execute_proposal` CPI. Every program upgrade routes through this program before reaching the Squads multisig — proposal signal happens here, the multisig sign and the BPF Loader v3 swap happen at the Squads layer, but the proposal record + timelock window + voter audit trail are all on-chain in this program.

Voting power derives from NXSStaking — `effective_stake` at proposal-creation slot, snapshotted into `ProposalAccount.snapshot` so vote weight cannot be mutated mid-window. Five proposal categories — ParameterChange, ProgramUpgrade, TreasurySpend, EmergencyPause, CapabilityTagUpdate — each carry their own timelock per §2.6 ladder. Self-upgrade and multisig membership changes are meta-governance, gated on Squads 6-of-9 and a 21-day timelock per §2.6.

Bad-faith / malicious proposals are not slashed in M2 (no on-chain definition of bad-faith for governance — vote-buying is the obvious adversary but uneconomical to detect on-chain). Proposer collateral (returned on pass, slashed to fee_collector on fail-without-quorum) replaces the slashing rail.

## State

### `GovernanceConfig` PDA — singleton
- **Seeds:** `[b"governance_config"]`
- **Fields:**
  - `authority: Pubkey` — Squads 6-of-9 meta-governance multisig (per §2.6)
  - `nxs_staking: Pubkey` — voting power source
  - `capability_registry: Pubkey` — CapabilityTagUpdate target
  - `fee_collector: Pubkey` — slashed proposer collateral destination + TreasurySpend source
  - `emergency_council: Pubkey` — Squads 4-of-7 (per §1.3 Pausable extension authority)
  - `program_registry: Pubkey` — `ProgramRegistry` PDA (CPI target whitelist)
  - `min_proposer_stake: u64` — default `100_000 * 10^decimals` per backend spec — keeps grief-proposing economically expensive
  - `proposer_collateral: u64` — default `10_000 * 10^decimals`, slashed to fee_collector if proposal fails without quorum
  - `vote_window_secs_standard: i64` — `5 * 86400` (5 days)
  - `vote_window_secs_emergency: i64` — `86400` (24h)
  - `vote_window_secs_meta: i64` — `7 * 86400` (7 days)
  - `quorum_bps: u16` — default 400 (4% of total NXS stake snapshot must vote)
  - `pass_threshold_bps: u16` — default 5000 (>50% of For + Against weight votes For)
  - `meta_pass_threshold_bps: u16` — default 6667 (≥66.67% supermajority for meta-governance)
  - `timelock_secs_standard: i64` — `7 * 86400` per §2.6
  - `timelock_secs_critical: i64` — `14 * 86400` per §2.6 (TaskMarket / DisputeArbitration upgrades)
  - `timelock_secs_meta: i64` — `21 * 86400` per §2.6 (GovernanceProgram self-upgrade / membership change)
  - `min_lock_to_vote_secs: i64` — `30 * 86400` — staked NXS must be locked at least 30d to count for voting (deterrent to flash-loan votes)
  - `dev_mode_timelock_override_secs: i64` — `48 * 3600` (48h per §4.3 devnet bring-up); zero on mainnet (toggle via meta-governance)
  - `paused: bool` — global proposal-creation pause (vote / execute on already-active proposals continue)
  - `bump: u8`

### `ProgramRegistry` PDA — singleton allowlist of CPI execution targets
- **Seeds:** `[b"program_registry"]`
- **Fields:**
  - `entries: Vec<RegisteredProgram>` — bounded at 32; reallocated via meta-governance
  - `bump: u8`

  ```
  struct RegisteredProgram {
      program_id: Pubkey,
      label: [u8; 16],            // human label e.g. "task_market"
      is_critical: bool,          // governs 7d vs 14d timelock per §2.6
      param_authority_seed: [u8; 32],  // PDA seed prefix that this program checks for governance authority
      max_param_payload_bytes: u16,    // upper bound on serialized ix data, anti-DoS
  }
  ```

- Entries seeded at deployment per §4.3 order: AgentRegistry, TreasuryStandard, TaskMarket (critical), DisputeArbitration (critical), FeeCollector, ProofVerifier, CapabilityRegistry. NXSStaking added once it lands. New entries require meta-governance proposal.

### `ProposalAccount` PDA
- **Seeds:** `[b"proposal", proposal_id.to_le_bytes()]` — `proposal_id: u64` monotonic from `GovernanceConfig.next_proposal_id` (added below)
- **Fields:**
  - `proposal_id: u64`
  - `proposer: Pubkey`
  - `proposer_stake_pda: Pubkey` — NXSStaking account proving min_proposer_stake at create-time
  - `proposer_collateral_escrow: Pubkey` — token account holding `proposer_collateral`
  - `category: ProposalCategory`
  - `effect: ProposalEffect` — borsh-tagged union, one of ParameterChange / ProgramUpgrade / TreasurySpend / EmergencyPause / CapabilityTagUpdate
  - `metadata_uri: [u8; 128]` — IPFS / Arweave URI for human-readable rationale (off-chain mandatory; on-chain optional)
  - `snapshot: ProposalSnapshot` — see below
  - `status: ProposalStatus`
  - `created_at: i64`
  - `vote_start: i64` — equal to created_at; voting opens immediately on creation
  - `vote_end: i64`
  - `tallied_at: i64`
  - `executable_at: i64` — `tallied_at + timelock_for(category)`
  - `executed_at: i64`
  - `for_weight: u128`
  - `against_weight: u128`
  - `abstain_weight: u128`
  - `bump: u8`

  ```
  struct ProposalSnapshot {
      total_eligible_weight: u128,   // sum of effective_stake across all NXSStaking accounts where lock >= min_lock_to_vote_secs
      snapshot_slot: u64,            // slot at which the snapshot was taken
      snapshot_root: [u8; 32],       // merkle root over (staker, weight); voters supply inclusion proof in `vote`
  }
  ```

  Snapshot is computed off-chain by a permissionless cranker (NXSStaking exposes a `compute_snapshot_root` view) and committed at `propose` time. The merkle proof shape avoids the O(N) on-chain pass over all stakers — same pattern as Solana governance v4 / Realms `Solution=MerkleSnapshot`.

### `VoteRecord` PDA
- **Seeds:** `[b"vote", proposal.as_ref(), voter.as_ref()]`
- **Fields:**
  - `proposal: Pubkey`
  - `voter: Pubkey`
  - `choice: VoteChoice`
  - `weight: u128` — read from merkle proof at vote-time; rejected if doesn't match
  - `cast_at: i64`
  - `bump: u8`

  One vote per (proposal, voter). No vote change. Delegation is out of scope for M2 (Open Question — see below).

### `ExecutionRecord` PDA — written when `execute_proposal` succeeds OR fails terminally
- **Seeds:** `[b"execution", proposal.as_ref()]`
- **Fields:**
  - `proposal: Pubkey`
  - `executed_at: i64`
  - `result: ExecutionResult` — `Ok | CpiFailed { code: u32 } | TargetMissing | PayloadInvalid`
  - `cpi_target: Pubkey` — actual program_id invoked (from ProgramRegistry)
  - `cpi_payload_hash: [u8; 32]` — sha256 of the ix data sent
  - `bump: u8`

### `EmergencyAction` PDA — written when emergency council invokes pause/unpause directly
- **Seeds:** `[b"emergency", action_id.to_le_bytes()]`
- **Fields:**
  - `action_id: u64`
  - `target_program: Pubkey`
  - `kind: EmergencyKind` — `Pause | Unpause`
  - `invoked_at: i64`
  - `expires_at: i64` — pause auto-expires after 14d unless ratified via standard proposal (force-thaw to prevent indefinite emergency state)
  - `ratified_proposal: Option<u64>` — set when a passed proposal extends/cancels
  - `bump: u8`

### `MetaGovernanceProposal` PDA — overlay struct for category=Meta proposals
- Same shape as `ProposalAccount` but wrapped via category gate; the wrapping tags it for the 6-of-9 + 21-day path. Modeled as a category variant (not a separate PDA) to keep the indexer reading one stream.

## Enums

```
enum ProposalCategory {
    ParameterChange,        // 7d timelock, 4-of-7 effective execution path (CPI authority is governance PDA)
    ProgramUpgrade,         // 7d standard / 14d critical (per ProgramRegistry.is_critical)
    TreasurySpend,          // 7d timelock; CPI to TreasuryStandard, capped at config.max_single_spend
    EmergencyPause,         // 24h vote, instant on pass; or invoked directly by emergency council without vote
    CapabilityTagUpdate,    // 7d timelock; CPI to CapabilityRegistry::propose_tag / approve_tag / revoke_tag
    Meta,                   // 7d vote, 21d timelock, 6-of-9 multisig sign on execute (GovernanceProgram self-upgrade or membership change)
}

enum ProposalStatus {
    Voting,                 // voting open
    Passed,                 // tallied, met quorum + threshold, in timelock
    Rejected,               // tallied, failed quorum or threshold; collateral slashed
    Queued,                 // timelock elapsed, ready for execute
    Executed,               // CPI success
    Failed,                 // CPI failed terminally
    Cancelled,              // proposer-cancelled pre-vote-start (only legal in same-tx as propose) OR emergency-vetoed
    Expired,                // queued but not executed within `execution_window_secs` (default 14d)
}

enum VoteChoice { For, Against, Abstain }

enum ExecutionResult { Ok, CpiFailed { code: u32 }, TargetMissing, PayloadInvalid }

enum EmergencyKind { Pause, Unpause }

enum ProposalEffect {
    ParameterChange { target_program: Pubkey, ix_data: Vec<u8> },
    ProgramUpgrade  { target_program: Pubkey, buffer: Pubkey, spill: Pubkey },
    TreasurySpend   { source_treasury: Pubkey, destination: Pubkey, mint: Pubkey, amount: u64, memo: [u8; 64] },
    EmergencyPause  { target_program: Pubkey, kind: EmergencyKind },
    CapabilityTagUpdate { kind: CapabilityTagOp, slug: [u8; 32], manifest_uri: [u8; 128], bit: Option<u8> },
}

enum CapabilityTagOp { Propose, Approve, Revoke, UpdateManifest }
```

`Cancelled` / `Executed` / `Failed` / `Expired` / `Rejected` are terminal. `Voting → Passed → Queued → (Executed | Failed | Expired)` is the happy path.

## State machine

```
            propose
              |
              v
          Voting  --proposer_cancel (same tx only)--> Cancelled
              |
        (vote_end elapsed)
              |
              v
          finalize_vote
        /     |       \
       /      |        \
   Passed   Rejected   Cancelled (emergency_veto)
      |
  (timelock elapsed)
      v
    Queued  --execution_window expires--> Expired
      |
   execute_proposal
      |
   +--+--+
   |     |
  Ok    CpiFailed
   v     v
Executed Failed
```

`Rejected` immediately slashes `proposer_collateral` to `fee_collector`. `Passed` returns collateral to proposer. `Cancelled (same-tx)` returns collateral. `Expired` returns collateral (proposer not at fault if no cranker called execute).

## Instructions

### `init_config(params: InitParams)` — one-shot, deployer

- **Effect:** initialize `GovernanceConfig` and `ProgramRegistry`. Seeds 7 RegisteredProgram entries per §4.3 deploy order. Emits `ConfigInitialized`.
- Devnet bring-up sets `dev_mode_timelock_override_secs = 48h` per §4.3. Mainnet init runs with override = 0.

### `register_program(label, program_id, is_critical, param_authority_seed, max_param_payload_bytes)`
- **Signers:** `authority` (meta-governance multisig — Squads 6-of-9)
- **Validation:** `entries.len() < 32`. No duplicate `program_id`.
- **Effect:** appends new entry. Used to onboard NXSStaking once it lands, and any post-M2 program.
- **Emits:** `ProgramRegistered`

### `propose(category, effect, metadata_uri, snapshot)` — permissionless
- **Signers:** `proposer`
- **Validation:**
  - `!config.paused`.
  - CPI-read NXSStaking: `proposer_stake.amount >= min_proposer_stake`, `proposer_stake.lock_unlock_slot - now >= min_lock_to_vote_secs`.
  - Transfer `proposer_collateral` from proposer's NXS account into `proposer_collateral_escrow` PDA via `transfer_checked`.
  - For non-Meta categories: validate `effect.target_program` (or implied target) is in `ProgramRegistry`.
  - For Meta: only allowed if signer == `authority` (Squads 6-of-9 already gates entry to this category).
  - For TreasurySpend: `effect.amount <= config.max_single_spend` (separate field on GovernanceConfig, default `1_000_000 * 10^decimals` USDC equivalent — proposed as ratifiable Open Question).
  - `snapshot.snapshot_slot >= now_slot - 100` (snapshot must be fresh — within ~40s of propose to prevent stale-stake voting).
  - CPI NXSStaking::`verify_snapshot_root(snapshot_slot, snapshot_root)` to confirm the merkle root matches what NXSStaking computes.
- **Effect:** allocates `ProposalAccount` with `proposal_id = config.next_proposal_id`, `status = Voting`, `vote_start = now`, `vote_end = now + vote_window_secs_for(category)`. Increments `config.next_proposal_id`.
- **Emits:** `ProposalCreated { id, category, proposer, vote_end }`
- **CU target:** 40k (per §2.1)

### `proposer_cancel(proposal_id)` — same-tx-as-propose only
- **Signers:** `proposer`
- **Validation:** `status == Voting`, `for_weight + against_weight + abstain_weight == 0`. (Once anyone has voted, cancel is forbidden — protects voter expectations.)
- **Effect:** `status = Cancelled`. Returns proposer collateral. Closes `ProposalAccount`.
- **Emits:** `ProposalCancelled { id, by_proposer: true }`

### `vote(proposal_id, choice, weight, merkle_proof: Vec<[u8; 32]>)`
- **Signers:** `voter`
- **Validation:**
  - `status == Voting`, `now <= vote_end`.
  - No prior `VoteRecord` for `(proposal, voter)`.
  - Verify merkle inclusion: `keccak256(voter || weight) ↪ snapshot.snapshot_root` via `merkle_proof`.
- **Effect:** creates `VoteRecord { choice, weight, cast_at }`. Increments per-choice tally on `ProposalAccount`. (u128 saturating ranges — checked add.)
- **Emits:** `VoteCast { proposal, voter, choice, weight }`
- **CU target:** 20k (per §2.1; merkle proof depth ≤ 24 keeps verify ~10k CU within budget)

### `finalize_vote(proposal_id)` — permissionless crank
- **Validation:** `status == Voting`, `now > vote_end`.
- **Effect:**
  - `cast_weight = for_weight + against_weight + abstain_weight`.
  - `quorum_met = cast_weight >= snapshot.total_eligible_weight * quorum_bps / 10000`.
  - `pass_threshold = (category == Meta) ? meta_pass_threshold_bps : pass_threshold_bps`.
  - `decision_weight = for_weight + against_weight` (abstain counted for quorum but not for threshold).
  - `passed = quorum_met && (for_weight * 10000 / decision_weight >= pass_threshold)` — guards `decision_weight == 0` as `passed = false`.
  - On pass: `status = Passed`, compute `executable_at = now + timelock_for(category, target_is_critical)`. Devnet: `executable_at = now + max(dev_mode_timelock_override_secs, ...)`.
  - On fail: `status = Rejected`. Slash `proposer_collateral_escrow` → `fee_collector` via `transfer_checked`.
- **Emits:** `ProposalFinalized { id, status, for_weight, against_weight, abstain_weight, quorum_met }`

### `queue_execution(proposal_id)` — permissionless crank, no-op transition convenience
- **Validation:** `status == Passed`, `now >= executable_at`.
- **Effect:** `status = Queued`. Sets `expires_at = now + execution_window_secs` (default 14d).
- **Emits:** `ProposalQueued`

### `execute_proposal(proposal_id, remaining_accounts...)` — permissionless crank
- **Validation:**
  - `status == Queued`, `now <= queued_at + execution_window_secs`.
  - For Meta + ProgramUpgrade: signer = `authority` (Squads multisig of correct shape). Anchor multi-sig check: address must equal `config.authority` (Meta) or `program_registry[target].upgrade_multisig` (ProgramUpgrade — 4-of-7 standard, 6-of-9 if target == GovernanceProgram).
  - Target program ID matches the entry from `ProgramRegistry`.
  - `cpi_payload` size ≤ `max_param_payload_bytes` for the target.
- **Effect (state-before-CPI per §5.1):**
  - Set `status = Executed`, write `ExecutionRecord { result: PendingCpi }`, then invoke CPI.
  - On CPI success: update `ExecutionRecord.result = Ok`. Return proposer collateral.
  - On CPI failure (CPI Result is Err): roll `status` to `Failed`, persist `ExecutionResult::CpiFailed { code }`. Proposer collateral STILL returned — vote was honored even if the target rejected the call.
  - Reentrancy guard set on entry, cleared on return per §5.1 + matches the cycle 60+ pattern across the 5 M1 programs.
- Per category dispatch:
  - **ParameterChange:** CPI `target_program` with the proposal-supplied `ix_data`. Target program reads its `param_authority` PDA (derived from `param_authority_seed`) and verifies the signer-authority on the ix is `governance_authority` PDA (this program's `[b"executor"]` PDA, signed via `invoke_signed`).
  - **ProgramUpgrade:** Two-step. (a) Governance writes `UpgradeAuthorization` PDA with `(target, buffer, spill, executable_at)`; (b) Squads multisig observes the authorization on-chain and submits the BPF Loader v3 `upgrade` ix off-chain. The on-chain effect of `execute_proposal` for ProgramUpgrade is the `UpgradeAuthorization` write, NOT the actual loader call. Squads is the chain-of-custody.
  - **TreasurySpend:** CPI `TreasuryStandard::spend(destination, mint, amount, memo, governance_attestation)`. TreasuryStandard validates the attestation = governance authority PDA.
  - **EmergencyPause:** CPI `target_program::set_paused(kind == Pause)`. Writes `EmergencyAction` if invoked via this path (vs. direct council path).
  - **CapabilityTagUpdate:** CPI `CapabilityRegistry::{propose_tag | approve_tag | revoke_tag | update_manifest}` per `CapabilityTagOp`.
- **Emits:** `ProposalExecuted { id, result }`
- **CU target:** 80k (per §2.1) — CPI dominated; merkle work front-loaded into `vote`

### `expire_proposal(proposal_id)` — permissionless crank
- **Validation:** `status == Queued`, `now > expires_at`.
- **Effect:** `status = Expired`. Returns proposer collateral. Closes execution accounts.
- **Emits:** `ProposalExpired`

### `emergency_pause(target_program, kind)` — direct invocation by emergency council
- **Signers:** `emergency_council` (Squads 4-of-7 per §1.3 Pausable extension)
- **Validation:** target in `ProgramRegistry`. No active `EmergencyAction` for `(target, Pause)` (no double-pause).
- **Effect:** writes `EmergencyAction { kind: Pause, expires_at: now + 14d }`. CPIs `target_program::set_paused(true)` immediately.
- **Emits:** `EmergencyInvoked { target, action_id }`

### `emergency_veto(proposal_id)` — emergency council can veto a Passed proposal during its timelock
- **Signers:** `emergency_council`
- **Validation:** `status ∈ {Passed, Queued}`. Emergency veto cannot apply to Meta category (meta-gov bypasses council).
- **Effect:** `status = Cancelled`. Slash collateral (council vetoed = bad-faith proposal signal). Writes `ExecutionRecord { result: TargetMissing }` for indexer continuity.
- **Emits:** `ProposalVetoed`

### `unpause(target_program)` — emergency council OR ratifying proposal
- **Signers:** `emergency_council` OR governance authority PDA
- **Validation:** active `EmergencyAction { kind: Pause }` for target.
- **Effect:** CPIs `target_program::set_paused(false)`. Writes `EmergencyAction { kind: Unpause, expires_at: now }`.
- **Emits:** `EmergencyResolved`

### `set_params(new_params)` — Meta-governance only
- **Signers:** `authority` (Squads 6-of-9), invoked via Meta proposal execute path
- Updates a subset of `GovernanceConfig` fields (windows, quorum, thresholds, collateral). Slash-cap analog of the AgentRegistry pattern.

### `transfer_authority(new_authority)` — Meta-governance only
- Two-step (propose / accept) per the same surface as AgentRegistry / TreasuryStandard `transfer_authority`.

## Events

M1 actually-emit (per `programs/governance_program/src/events.rs` + `emit!` call sites in `instructions/*`): `ConfigInitialized`, `ProgramRegistered`, `ProposalCreated`, `VoteCast`, `ProposalFinalized`, `ProposalExecuted`, `ProposalCancelled`, `ProposalExpired`, `PausedSet`. `PausedSet` is IDL-only relative to the pre-edit spec list — the scaffold wires it on the `set_paused` ix at `cancel_expire.rs:106`, covering both `authority`-initiated and `emergency_council`-initiated pauses.

Forward-looking M2-reserved (paired with spec-enumerated ixs not yet scaffolded against dedicated event types): `ProposalQueued` (→ `queue_execution` — the ix exists at M1 at `execute.rs:19` but emits nothing; the `Passed → Queued` status transition is inferable off `ProposalAccount.executable_at`, so no distinct event at M1), `ProposalVetoed` (→ `emergency_veto` — not scaffolded), `EmergencyInvoked` (→ `emergency_pause` — not scaffolded; `set_paused` at M1 covers the direct-pause shape without the council-proposal wrapper), `EmergencyResolved` (→ `unpause` / auto-thaw — not scaffolded), `ParamsUpdated` (→ per-program `set_params` — currently handled at M1 via `execute_proposal(ParameterChange)` CPI-out to the target program rather than via a governance-level event), `AuthorityTransferProposed` + `AuthorityTransferred` (→ the two-step `transfer_authority(new_authority)` surface per §`transfer_authority` — not yet scaffolded; meta-governance-gated). No struct-only guard events ship in the IDL — governance_program's ix surface is `authority` / `emergency_council` / `meta_authority`-gated via direct `require!` checks rather than the reentrancy-guard module pattern that `agent_registry` / `task_market` / `treasury_standard` / `proof_verifier` / `fee_collector` / `nxs_staking` / `dispute_arbitration` carry, so the 5-event guard vocabulary (`GuardEntered`, `ReentrancyRejected`, `GuardInitialized`, `GuardAdminReset`, `AllowedCallersUpdated`) has no scaffold-parity here at M1.

Proposal-scoped events carry `proposal_id: u64` — present on 6 of 9 emitted events (`ProposalCreated`, `VoteCast`, `ProposalFinalized`, `ProposalExecuted`, `ProposalCancelled`, `ProposalExpired`). `target_program: Pubkey` rides only on `ProposalCreated` (the proposal-time CPI target); `ProgramRegistered` carries `program_id: Pubkey` (the just-registered target) + `label: [u8; 16]` + `is_critical: bool`. `ConfigInitialized` + `PausedSet` carry `authority: Pubkey` — on `PausedSet` this is the calling signer, which may be either `config.authority` or `config.emergency_council` per the `Unauthorized`-gated branch at `cancel_expire.rs:97-101`. `VoteCast` carries `voter` + `choice` + `weight: u128` (the merkle-proven voting weight); `ProposalFinalized` carries `status: ProposalStatus` + `for_weight` / `against_weight` / `abstain_weight` (all `u128`); `ProposalExecuted` carries `cpi_target: Pubkey` + `success: bool`; `ProposalCancelled` carries `by: Pubkey`. All 9 M1-emit events carry `timestamp: i64`; none carry `slot` in the event body — the indexer resolves slot from the containing transaction, same convention as `fee_collector` / `nxs_staking` / `dispute_arbitration`. The indexer can replay any proposal lifecycle deterministically off `(proposal_id, timestamp)` plus the per-event payload.

## Errors

`Unauthorized`, `Paused`, `WrongStatus`, `VotingClosed`, `VotingOpen`, `QuorumNotMet`, `ThresholdNotMet`, `DuplicateVote`, `MerkleProofInvalid`, `SnapshotStale`, `WeightOverflow`, `ProposalNotInTimelock`, `TimelockNotElapsed`, `ExecutionWindowExpired`, `TargetNotRegistered`, `PayloadTooLarge`, `CategoryRequiresMeta`, `EmergencyVetoNotApplicable`, `EmergencyAlreadyActive`, `ProposerStakeInsufficient`, `ProposerLockTooShort`, `CollateralTransferFailed`, `CpiTargetMissing`, `CpiFailed`, `ArithmeticOverflow`, `ReentrancyDetected`, `UnauthorizedCaller`, `CpiDepthExceeded`. (Reentrancy / caller / CPI depth errors reuse the existing scaffold enum landed at `2f76d3f`.)

## CU budget (§2.1 targets)

| Instruction | Target |
|---|---|
| `init_config` | 80k (one-shot) |
| `register_program` | 30k |
| `propose` | 40k |
| `proposer_cancel` | 25k |
| `vote` | 20k (incl. merkle proof depth 24) |
| `finalize_vote` | 50k |
| `queue_execution` | 15k |
| `execute_proposal` (ParameterChange) | 80k (CPI dominated) |
| `execute_proposal` (TreasurySpend) | 100k |
| `execute_proposal` (EmergencyPause) | 60k |
| `execute_proposal` (CapabilityTagUpdate) | 70k |
| `execute_proposal` (ProgramUpgrade) | 30k (only writes UpgradeAuthorization PDA; no loader CPI) |
| `expire_proposal` | 25k |
| `emergency_pause` | 50k |
| `emergency_veto` | 35k |
| `unpause` | 50k |

`execute_proposal` matches the §2.1 80k target on the median (ParameterChange) path. ProgramUpgrade is cheaper because the BPF Loader v3 swap is off-chain via Squads — only the authorization is on-chain.

## Invariants

1. `next_proposal_id` is monotonic and never decremented. `ProposalAccount` PDA seed is unique across the program's lifetime.
2. One `VoteRecord` per `(proposal, voter)`. No vote-change instruction exists.
3. `for_weight + against_weight + abstain_weight <= snapshot.total_eligible_weight`.
4. `weight` in every `VoteRecord` matches the merkle leaf at `snapshot_root` for that voter — enforced at vote-time, not finalize.
5. `executable_at >= tallied_at + timelock_for(category)` always; never short-circuited.
6. Meta proposals require `authority == Squads 6-of-9` to execute, regardless of vote pass — vote alone is necessary but not sufficient.
7. ProgramUpgrade `UpgradeAuthorization` PDAs cannot be claimed by anyone other than the registered upgrade multisig for that program (loader-side check).
8. EmergencyPause via council is auto-revoked at `expires_at` if no ratifying proposal extends it — no indefinite pause.
9. Proposer collateral has exactly one of three terminal destinations: returned to proposer (Passed / Cancelled-same-tx / Expired), slashed to fee_collector (Rejected / Vetoed). Never trapped.
10. `dev_mode_timelock_override_secs` is only honored when it EXTENDS the natural timelock (max of computed + override). Cannot shorten a timelock; meta-gov can only set it to 0 (production) or positive (dev shadowing).
11. `EmergencyAction` is single-active per `(target, Pause)` pair. Council cannot stack pauses.
12. CPI from `execute_proposal` runs at most once per `ProposalAccount`. State-before-CPI rule: `status = Executed` is written before invoke; on CPI fail the rollback writes `Failed`.
13. `min_lock_to_vote_secs` enforced at vote-time (not snapshot-time) — voter's stake lock at `cast_at` must still satisfy. Prevents withdrawing-stake from voting.

## Security checks (backend §5.1)

- **Account Validation:** Anchor seeds + bumps on every PDA above. CPI identities for NXSStaking / CapabilityRegistry / FeeCollector / TreasuryStandard / DisputeArbitration / TaskMarket / AgentRegistry / ProofVerifier read from `GovernanceConfig` and `ProgramRegistry` — hard equality, never caller-supplied. Discriminator enforced on every account read.
- **Re-entrancy:** outbound CPI in `execute_proposal` flips this program's reentrancy guard before invoke; if a malicious target program upgrade attempts to CPI back into `propose` / `vote` / `execute_proposal`, the guard rejects. State-before-CPI: `status = Executed` written before invoke, so even on a successful re-entry the duplicate `execute_proposal` call sees `WrongStatus` and exits. Mirrors the AgentRegistry slash + DisputeArbitration resolve patterns.
- **Authorization (§5.1: "emergency pause respected"):** every mutable instruction is operator-or-program-authority gated. `propose` requires proposer stake. `vote` requires voter signer + merkle inclusion. `finalize_vote` / `queue_execution` / `expire_proposal` are permissionless crank (status-gated). `execute_proposal` for Meta + ProgramUpgrade requires multisig signer. `emergency_pause` / `emergency_veto` / `unpause` require emergency council signer. Pause flag blocks `propose` only — does not block `vote` / `finalize_vote` / `execute_proposal` so an in-flight proposal cannot be trapped.
- **Integer Safety:** all weight math in `u128` with `checked_mul` / `checked_div`. Quorum / threshold ratios use `mul_div_floor(weight, bps, 10000)` to avoid intermediate truncation.
- **Slashing Safety (§5.1: "30-day timelock"):** governance does not slash arbitrators or agents directly — those rails live in DisputeArbitration / AgentRegistry. The proposer-collateral slash on Rejected is NOT subject to the 30d slashing-safety rule because it's a voluntary deposit, not a stake; the governance economic model treats it as forfeit-on-fail collateral, not punitive slashing. Documented in Open Questions for reviewer ratification.
- **Upgrade Safety (§5.1: "All upgrade authorities in Squads multisig from day 1"):** GovernanceProgram itself is upgrade-authority = Squads 6-of-9 from day 1 per §2.6. ProgramUpgrade proposals do not invoke the BPF Loader directly — they write `UpgradeAuthorization` PDAs that the relevant Squads multisig consumes. No on-chain mechanism for governance to upgrade itself bypassing Squads.
- **Token Safety:** All proposer collateral and TreasurySpend movement uses Token-2022 `transfer_checked`. No raw `transfer`. NXS stake reads via NXSStaking CPI — no direct token-account inspection.
- **Pause:** `paused` flag blocks `propose`. `vote` and execution paths are NOT blocked — pausing must not trap an active proposal mid-flight.
- **Oracle Safety (§5.1: "All Pyth/Switchboard validated"):** GovernanceProgram has no direct oracle reads. Inherited transitively via TreasuryStandard CPI on TreasurySpend execution — that program's oracle staleness checks (cycle: treasury_standard 60s + 1% confidence) gate the spend.
- **Jito bundle assumption:** `propose` + `vote` + `finalize_vote` are independent transactions across days. No bundle atomicity. `execute_proposal` is a single-tx CPI that does not rely on Jito guarantees.
- **DOS surface:** `ProgramRegistry` capped at 32 entries; merkle proof depth capped at 24 (covers ~16M stakers); `ProposalAccount` allocation requires `proposer_collateral` so proposal spam is economically bounded. Vote spam is bounded by NXSStaking onboarding (not free).

## CPI contract with target programs

GovernanceProgram is the canonical authority for parameter mutations across the 6 core programs. Each target program must:

1. Expose a `set_params` (or per-knob equivalent) instruction whose authority check is the GovernanceProgram executor PDA `[b"executor"]` derived under GovernanceProgram's program ID.
2. Read its own `governance` field from its config PDA at deploy-time and never mutate it (it equals the GovernanceProgram PDA permanently).
3. Expose `set_paused(bool)` with the same executor PDA gate.
4. For TreasurySpend: TreasuryStandard exposes `spend(destination, mint, amount, memo, governance_attestation)` — attestation = signer Pubkey of executor PDA.
5. For CapabilityTagUpdate: CapabilityRegistry's existing `propose_tag` / `approve_tag` / `revoke_tag` / `update_manifest` accept executor PDA as authority.

ProgramUpgrade does NOT use this pattern — it writes `UpgradeAuthorization` PDAs that the Squads multisig consumes. No CPI to BPF Loader from this program.

## Devnet bring-up notes (§4.3)

- `init_config` runs with `dev_mode_timelock_override_secs = 48h` per §4.3.
- The first Meta proposal on devnet is "set `dev_mode_timelock_override_secs = 0`" for production-mainnet timelock testing. Proves the override-toggle path works before mainnet deploy.
- ProgramRegistry seeded with the 7 M1+M2 programs at init. NXSStaking added via Meta proposal post-NXSStaking deploy.

## Open questions for reviewer

- **Voting power model.** Spec picks NXSStaking `effective_stake` snapshot at proposal-create slot. Reviewer may want time-locked weighting (veNXS-style 1×–4× based on lock duration). Trade-off: time-weighting better aligns long-term holders with protocol health, but adds a second config dimension and a recompute on every lock change. Default: linear stake weight + `min_lock_to_vote_secs = 30d` gate. Open for upgrade to veNXS post-M3.
- **Quorum default 4%.** Compound governance v2 used 4%; Realms uses 1-10% range. 4% is a reasonable middle for a young protocol with concentrated stake. Reviewer sets the floor.
- **Pass threshold 50% / Meta 66.67%.** Standard Compound shape. Reviewer may want category-specific thresholds (TreasurySpend ≥60% to slow capital flight).
- **Snapshot freshness 100 slots (~40s).** Tighter than typical (Realms uses no freshness gate, snapshot is at vote-time). Reviewer trade-off: tighter window prevents stake-rebalance-then-propose attacks but risks legitimate proposals failing if slot drift outpaces the window.
- **Proposer collateral slash on Rejected.** Spec slashes to fee_collector if proposal fails to meet quorum-or-threshold. Counter-argument: this discourages legitimate experimental proposals. Alternative: slash only if quorum NOT met (no-quorum = grief signal); return collateral on quorum-met + threshold-failed. Default: slash on any non-pass, except `Cancelled-same-tx` / `Expired`. Reviewer ratifies.
- **Vote delegation deferred to post-M2.** Spec has no `delegate(to: Pubkey)` instruction. Realms supports this; M2 scope keeps it simple. Open Question to reviewer: ship M2 without delegation, add in M3 once we have stake distribution data?
- **Emergency pause auto-expiry 14d.** Tension with §1.3 Pausable extension being "Phase 3 only" — implies the council pause path is rarely-used. 14d auto-thaw forces ratification within a sane window. Reviewer may want shorter (7d) or longer (30d).
- **TreasurySpend cap.** Spec proposes `max_single_spend = 1M USDC equivalent`. No PDF anchor — reviewer ratifies.
- **Vote weight rounding.** `mul_div_floor` chosen to bias against the proposer (round-down on quorum check, round-down on threshold check). Reviewer may prefer round-half-even for fairness.
- **Meta proposal vote window 7d vs 14d.** Spec picks 7d to match standard pass + 21d timelock = 28d total. Some governance designs (Maker, Optimism) use longer voting periods on meta. Trade-off: longer window catches more voter participation but slows constitutional change.

## Done-checklist

- [ ] Full state machine implemented; illegal transitions rejected by status gate
- [ ] `propose` reads NXSStaking via CPI; rejects under-staked / under-locked proposers
- [ ] `propose` validates snapshot via NXSStaking::verify_snapshot_root
- [ ] `vote` merkle inclusion verified; mismatched leaf rejected
- [ ] `finalize_vote` quorum + threshold math matches spec; abstain counts only for quorum
- [ ] `queue_execution` / `expire_proposal` permissionless paths exercised
- [ ] `execute_proposal` per-category dispatch (5 categories + Meta) works against scaffolded target programs
- [ ] `execute_proposal` ProgramUpgrade writes `UpgradeAuthorization` PDA; no direct loader CPI
- [ ] `emergency_pause` / `emergency_veto` / `unpause` council paths exercised
- [ ] `proposer_collateral` returned on Passed / Expired / Cancelled-same-tx; slashed on Rejected / Vetoed
- [ ] Meta proposal requires Squads 6-of-9 signer at execute-time, not just at finalize
- [ ] Reentrancy test: malicious target program upgrade attempts re-entry on `execute_proposal` — rejected
- [ ] CU measurements per instruction in `reports/governance-anchor.md`
- [ ] Golden-path integration test: stake NXS → propose ParameterChange → vote (3 voters) → finalize → wait 7d (bankrun warp) → queue → execute → target program param updated
- [ ] Meta-path test: propose Meta → vote → wait 21d → execute with 6-of-9 signature
- [ ] EmergencyPause test: council direct invoke → 14d wait → auto-thaw OR ratifying proposal extends
- [ ] IDL at `target/idl/governance_program.json`
- [ ] Security auditor pass (§5.1); findings closed
- [ ] Reviewer gate green; spec ready for Neodyme M2 queue
