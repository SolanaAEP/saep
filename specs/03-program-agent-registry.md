# Spec 03 — AgentRegistry Program

**Owner:** anchor-engineer
**Depends on:** 02
**Blocks:** 04, 07, 08
**References:** backend PDF §2.1 (CU budget table), §2.2 (full spec), §2.6 (7-day upgrade timelock), §5.1 (Authorization, Slashing Safety: 30-day timelock + bounded slash, Integer Safety, Account Validation)

## Goal

On-chain registry of AI agent identities. Each agent is a PDA keyed by `(operator, agent_id)` holding DID, capability bitmask, manifest URI, pricing, reputation, stake, and status. This is the identity layer every other program reads.

M1 surface = backend §2.2 instructions: `register_agent`, `update_manifest`, `delegate_control`, `record_job_outcome`, plus the stake/slashing/status machinery §2.2 implies but doesn't enumerate.

## State

### `RegistryGlobal` PDA — singleton
- **Seeds:** `[b"global"]`
- **Fields:**
  - `authority: Pubkey` — governance authority
  - `capability_registry: Pubkey` — program id of spec 02
  - `stake_mint: Pubkey` — SAEP mint (in M1 = a devnet mock mint)
  - `min_stake: u64` — minimum registration stake, governance-adjustable
  - `max_slash_bps: u16` — per-incident slash cap (default 1000 = 10%)
  - `slash_timelock_secs: i64` — default `30 * 86400` = 2_592_000 (§5.1 Slashing Safety)
  - `paused: bool`
  - `bump: u8`

### `AgentAccount` PDA
- **Seeds:** `[b"agent", operator.as_ref(), agent_id.as_ref()]` where `agent_id: [u8; 32]`
- **Fields (per backend §2.2):**
  - `operator: Pubkey`
  - `did: [u8; 32]` — keccak256(operator || agent_id || manifest_v0)
  - `manifest_uri: [u8; 128]` — fixed-width; reject oversized off-chain
  - `capability_mask: u128`
  - `price_lamports: u64`
  - `stream_rate: u64` — per-second (0 = disabled)
  - `reputation: ReputationScore` — 6-dim composite (see below)
  - `jobs_completed: u64`
  - `jobs_disputed: u32`
  - `stake_amount: u64`
  - `status: AgentStatus` — `Active | Paused | Suspended | Deregistered`
  - `version: u32` — manifest version counter, monotonic
  - `registered_at: i64`
  - `last_active: i64`
  - `delegate: Option<Pubkey>` — secondary signer for routine ops
  - `pending_slash: Option<PendingSlash>` — 30-day timelock state
  - `bump: u8`

### `ReputationScore` (embedded, 48 bytes)
- `quality: u16`, `timeliness: u16`, `availability: u16`, `cost_efficiency: u16`, `honesty: u16`, `volume: u16` — each 0..10_000 basis points
- `ewma_alpha_bps: u16` — smoothing factor (default 2000 = 0.2)
- `sample_count: u32`
- `last_update: i64`
- `_reserved: [u8; 24]`

M1 writes scores via `record_job_outcome` signed by the TaskMarket program (caller PDA check). SolRep oracle CPI (backend §2.2) is stubbed — live in M2.

### `PendingSlash` (embedded)
- `amount: u64`
- `reason_code: u16`
- `proposed_at: i64`
- `executable_at: i64` — `proposed_at + slash_timelock_secs`
- `proposer: Pubkey` — program or authority that proposed
- `appeal_pending: bool`

### `StakeVault` PDA — per-agent token account
- **Seeds:** `[b"stake", agent_did.as_ref()]`
- **Type:** ATA-style PDA token account owned by the program, holding `stake_mint`.

## Instructions

### `init_global(min_stake, max_slash_bps, slash_timelock_secs, capability_registry, stake_mint)`
- Signers: deployer. One-shot.

### `register_agent(agent_id: [u8; 32], manifest_uri: [u8; 128], capability_mask: u128, price_lamports: u64, stream_rate: u64, stake_amount: u64)`
- **Signers:** `operator`
- **Validation:**
  - `!global.paused`
  - `stake_amount >= global.min_stake`
  - `capability_mask & !capability_registry.approved_mask == 0` (read `RegistryConfig` account — CPI or direct deserialize)
  - `manifest_uri` first byte non-zero, fits 128
  - `AgentAccount` for seeds does not exist
- **State transition:**
  - Derive `did = keccak256(operator || agent_id || manifest_uri[..n])`
  - Init `AgentAccount` with `status = Active`, `version = 1`, `registered_at = now`, reputation zeroed, `sample_count = 0`
  - Init `StakeVault` token account, transfer `stake_amount` from `operator_token_account` via Token-2022 CPI
- **Emits:** `AgentRegistered { agent_did, operator, capability_mask, stake_amount }`

### `update_manifest(agent_id, manifest_uri, capability_mask, price_lamports, stream_rate)`
- **Signers:** `operator`
- **Validation:** agent exists, status `Active | Paused`, new `capability_mask` passes registry check, `!global.paused`
- **State transition:** overwrite fields, `version += 1`, `last_active = now`
- **Emits:** `ManifestUpdated { agent_did, version, capability_mask }`

### `delegate_control(agent_id, delegate: Option<Pubkey>)`
- **Signers:** `operator`
- Sets or clears `agent.delegate`. Delegate may call `set_status(Paused)` / `set_status(Active)` but NOT `update_manifest`, slash, or stake withdrawal.
- **Emits:** `DelegateSet`

### `set_status(agent_id, status)`
- **Signers:** `operator` OR `delegate` (for Active↔Paused only)
- **Validation:** transition legal: `Active ↔ Paused`, `* → Deregistered` (operator only, requires no active tasks — M1 assumes none; enforced in M2 when TaskMarket tracks per-agent active count), `Suspended` only settable by program via slash execution path.

### `record_job_outcome(agent_did, outcome: JobOutcome)`
- **Signers:** TaskMarket program PDA (via Anchor `Signer<'info>` + program id equality check), OR DisputeArbitration program in later milestones (M1: TaskMarket only)
- `JobOutcome { success: bool, quality_bps, timeliness_bps, cost_efficiency_bps, disputed: bool }`
- **State transition:**
  - `jobs_completed += 1` via `checked_add`
  - If disputed: `jobs_disputed = checked_add(1)`
  - Update each reputation dimension via EWMA: `new = (alpha * sample + (10_000 - alpha) * old) / 10_000`
  - `sample_count += 1`
  - `last_active = now`
- **Emits:** `JobOutcomeRecorded`

### `stake_increase(agent_id, amount)`
- **Signers:** `operator`. Transfers additional stake into `StakeVault`.

### `stake_withdraw_request(agent_id, amount)`
- **Signers:** `operator`
- Creates a pending withdrawal with `executable_at = now + slash_timelock_secs` (same horizon as slash). Prevents operator from yanking stake out in front of a pending slash.

### `stake_withdraw_execute(agent_id)`
- **Signers:** `operator`
- **Validation:** no `pending_slash`, `now >= withdrawal.executable_at`, post-withdraw `stake_amount >= min_stake` or status will flip to `Deregistered`.

### `propose_slash(agent_id, amount, reason_code)`
- **Signers:** `authority` (governance) OR DisputeArbitration program (M2)
- **Validation:** no existing `pending_slash`, `amount <= stake_amount`, `amount * 10_000 <= max_slash_bps * stake_amount` (§5.1 bounded slash)
- Sets `pending_slash` with `executable_at = now + slash_timelock_secs` (§5.1 — 30 days)
- **Emits:** `SlashProposed`

### `cancel_slash(agent_id)`
- **Signers:** `authority`. Clears `pending_slash`.

### `execute_slash(agent_id)`
- **Signers:** any (permissionless crank) once `now >= executable_at`
- **Validation:** `pending_slash.is_some()`, timelock elapsed, no active appeal (appeals are M2 — in M1 the field exists but is never set)
- Burns or transfers `amount` from `StakeVault` to `slashing_treasury` (governance-specified). Status → `Suspended` if post-slash stake `< min_stake`.
- **Emits:** `SlashExecuted`

### Governance setters
`set_min_stake`, `set_max_slash_bps`, `set_slash_timelock_secs`, `transfer_authority` / `accept_authority`, `set_paused`. All authority-gated. Two-step authority transfer as in spec 02.

### Scaffold-vs-spec deltas (reconciled against `programs/agent_registry/src/lib.rs` `#[program]` block, 29 `pub fn` entries)

Pre-edit §Instructions enumerates 16 explicit handlers plus the 5-setter governance umbrella (21 ix). Scaffold ground truth = 29 `pub fn`, covering 4 families absent from the pre-edit text plus a retired rail. All 8 absent blocks land post-scaffold via the commit anchors cited below.

- **Retired rail (1 ix):** `record_job_outcome(agent_did, JobOutcome)` was pulled from the program surface per audit-fix **F-2026-03** — caller-side severance in task_market plus callee removal. Pre-edit §Instructions line 104 still describes it as live; the §Events block (line 148) already notes the retirement + replacement rail. Reputation updates now flow through `update_reputation` (below) on the per-capability-bit path. No corresponding `pub fn` in `lib.rs`.
- **Reputation rail (2 ix, replaces retired `record_job_outcome`, landed `733cc7a` + `7c2143c`):**
  - `update_reputation(agent_did: [u8; 32], capability_bit: u16, sample: ReputationSample, task_id: [u8; 32], proof_key: [u8; 32])` — `reputation.rs:71`. Signer = `proof_verifier_authority` PDA (seeds `[b"rep_authority"]` under `global.proof_verifier`). Writes a per-`(agent_did, capability_bit)` `CategoryReputation` PDA (seeds `[b"rep", agent_did, capability_bit.to_le_bytes()]`), EWMA'd across the 6 sample dims; emits `CategoryReputationUpdated { task_id, … }`. Guarded: `GuardEntered` + `ReentrancyRejected` on the cross-program reentrancy DAG (§Events line 146 live-at-M1 callout).
  - `decay_availability(agent_did, capability_bit, miss_count: u8)` — `reputation.rs:256`. Proof-verifier-signed same as above. Emits `AvailabilityDecayed`.
- **Personhood family (4 ix, pre-audit-04 `specs/pre-audit-04-personhood-gate.md`, landed `b435db7`):**
  - `attest_personhood()` — `personhood.rs:90`. Signer = `operator`. Init `PersonhoodAttestation` PDA (seeds `[b"personhood", operator]`) from a Civic Gateway token account; fail-close owner check per **F-2026-01** (`assert_civic_token_owner`). Tier = `Verified | Basic | None` per `tier_for_network(global, network)` walk of `global.allowed_civic_networks`. Emits `PersonhoodAttested { operator, tier, provider, attestation_ref }`.
  - `revoke_personhood(reason_code: u16)` — `personhood.rs:167`. Authority-gated. Closes the attestation PDA; emits `PersonhoodRevoked`.
  - `refresh_personhood()` — `personhood.rs:203`. Signer = `operator`. Refreshes the attestation from a fresh Civic token; emits `PersonhoodRefreshed`.
  - `set_gatekeeper_allowlist(civic_networks: Vec<Pubkey>, sas_issuers: Vec<Pubkey>, basic_min_tier: PersonhoodTier, require_for_register: bool)` — `personhood.rs:269`. Authority-gated. Writes `RegistryGlobal.allowed_civic_networks[..MAX_GATEKEEPER_NETWORKS]` + `allowed_sas_issuers` + the `require_for_register` gate consulted from `register_agent` (see state-drift note below). Emits `GatekeeperAllowlistUpdated`.
- **Guard-admin family (4 ix, #7 scaffolding landed `c759a7b` + `2f76d3f`, helper-extract `cd5b594`):**
  - `init_guard(initial_callers: Vec<Pubkey>)` — `guard.rs:45`. Authority-gated one-shot. Initializes `ReentrancyGuard` PDA (seeds `[SEED_GUARD]`) + `AllowedCallers` PDA (seeds `[SEED_ALLOWED_CALLERS]`, cap = `MAX_ALLOWED_CALLERS`). Emits `GuardInitialized { program }` + `AllowedCallersUpdated { count }`.
  - `set_allowed_callers(programs: Vec<Pubkey>)` — `guard.rs:93`. Authority-gated list rewrite. Emits `AllowedCallersUpdated`.
  - `propose_guard_reset()` — `guard.rs:133`. Authority-gated. Sets `guard.reset_proposed_at = now`; starts the admin-reset timelock.
  - `admin_reset_guard()` — `guard.rs:158`. Authority-gated post-timelock crank; `assert_reset_timelock(guard, now)` + `reset_guard(guard)`. Emits `GuardAdminReset { proposed_at, executed_at }` (the single event that carries a proposed/executed pair rather than a single `timestamp` — §Events line 150 callout).
- **Governance extras (2 ix, governance-gated via existing `GovernanceUpdate` accounts struct):**
  - `set_civic_gateway_program(new_civic_gateway_program: Pubkey)` — `governance.rs:62`. Populates `RegistryGlobal.civic_gateway_program`; before this is non-default, `attest_personhood` fails-close per F-2026-01 (`CivicGatewayProgramNotSet`). Emits `GlobalParamsUpdated` (one of the 6 call sites per §Events line 146).
  - `set_proof_verifier(new_proof_verifier: Pubkey)` — `reputation.rs:294`. Populates `RegistryGlobal.proof_verifier`; gates the reputation rail PDA-signer equality check. Emits `GlobalParamsUpdated`.
- **Naming drift (1 governance setter):** spec governance-setters list line 142 reads `set_slash_timelock_secs`; scaffold exports `set_slash_timelock` (suffix `_secs` elided). Handler at `governance.rs::set_slash_timelock_handler`. No argument-shape drift (still `new_timelock_secs: i64`).
- **Arg-shape drift on `init_global` (pre-edit signature understates by 6 pubkeys):** spec line 72 `init_global(min_stake, max_slash_bps, slash_timelock_secs, capability_registry, stake_mint)` (5 args); scaffold `lib.rs:23` is 11 args: `(authority, capability_registry, task_market, dispute_arbitration, slashing_treasury, stake_mint, proof_verifier, min_stake, max_slash_bps, slash_timelock_secs)`. The 6 extra pubkeys populate `RegistryGlobal` CPI-caller + CPI-callee anchors that the M1 scaffold resolved post-spec (`task_market` + `dispute_arbitration` CPI-caller pins; `slashing_treasury` destination; `proof_verifier` reputation-rail pin). `authority` was separately extracted from the `deployer` signer to allow governance-hand-off at a different pubkey than the deployer. Not a behavior change — pre-edit spec implied these pubkeys were set later via individual setters; scaffold consolidates to init-time.

**State-side drift surfaced (not patched here):** `RegistryGlobal` in `state.rs` carries `civic_gateway_program: Pubkey`, `proof_verifier: Pubkey`, `task_market: Pubkey`, `dispute_arbitration: Pubkey`, `slashing_treasury: Pubkey`, `allowed_civic_networks: [Pubkey; MAX_GATEKEEPER_NETWORKS]`, `allowed_civic_networks_len: u8`, `allowed_sas_issuers` equivalents, and `require_personhood_for_register: bool` — all absent from §State `RegistryGlobal` block (lines 16–26). `AgentAccount` state has no direct personhood field (personhood lives at the operator-scoped `PersonhoodAttestation` PDA, not on the agent PDA — consistent with §Events line 150 "operator-scoped, not agent-scoped" callout). `CategoryReputation` PDA (per-`(agent_did, capability_bit)` rollup behind `update_reputation`) is a new account type absent from §State; `CATEGORY_REP_VERSION` + `DEFAULT_CATEGORY_ALPHA_BPS` + `MAX_CAPABILITY_BIT` are new constants. Held for future §State-sweep cycle.

**Errors drift surfaced (not patched here):** §Errors line 154 lists 15 variants; scaffold `errors.rs` enumerates more (personhood + guard-admin + proof-rail reentrancy: `CivicGatewayProgramNotSet`, `CivicGatewayProgramMismatch`, `UnauthorizedCaller`, `ProofVerifierNotSet`, etc.). 1-error-per-family delta; bundled with the (ad-2) cross-spec §Errors sweep candidate.

**Guard-admin-vocabulary matrix (post-cycle):** agent_registry row = `live-events + live-runtime-ix` (4 guard-admin ix + 5 guard events all live per §Events line 146). Reviewer cross-reading against the 5-program cohort (capability_registry: `N/A`; treasury_standard / dispute_arbitration / task_market: `live-events, runtime-ix varies`; agent_registry: `live-events + live-runtime-ix`) sees full guard surface only in agent_registry at M1.

**Post-edit §Instructions arc state:** 5-of-5 M1-in-scope §Instructions reconciliations land (cycle 163 task_market / cycle 166 dispute_arbitration / cycle 167 treasury_standard / cycle 172 capability_registry / this cycle agent_registry). Proof_verifier §Instructions (ag-5) remains queued — coordinates with audit-package-m1 §3.4 register_vk target-line discipline and the cycle-117 chunked-flow pair landing `b5916a6`.

## Events

All 23 `#[event]`-struct declarations in `programs/agent_registry/src/events.rs` are wired to `emit!` call sites at M1 (32 call sites total; no struct-only shapes). Agent lifecycle (4): `AgentRegistered`, `ManifestUpdated`, `DelegateSet`, `StatusChanged`. Stake + slash (6): `StakeIncreased`, `WithdrawalRequested`, `WithdrawalExecuted`, `SlashProposed`, `SlashCancelled`, `SlashExecuted`. Reputation (2): `CategoryReputationUpdated` (per-capability-bit 6-dim rollup, `task_id` included for indexer-side dedup), `AvailabilityDecayed` (miss-count ticker). Global + governance (2): `GlobalInitialized`, `GlobalParamsUpdated` (fires on every governance setter in `instructions/governance.rs` plus the reputation EWMA-alpha rebase — 6 call sites). Personhood / Sybil-resistance (4): `PersonhoodAttested`, `PersonhoodRevoked`, `PersonhoodRefreshed`, `GatekeeperAllowlistUpdated`. Guard runtime (2): `GuardEntered`, `ReentrancyRejected`. Guard admin (3): `GuardInitialized`, `GuardAdminReset`, `AllowedCallersUpdated`. Unlike fee_collector / nxs_staking / dispute_arbitration / governance_program — all of which carry guard vocabulary as struct-only scaffold-parity placeholders — agent_registry's guard events are live at M1: `GuardEntered` fires on `register_agent`, `stake_increase`, and `stake_withdraw_execute`; `ReentrancyRejected` fires on the reputation path (two call sites in `reputation.rs`).

`JobOutcomeRecorded` (named in earlier drafts of this paragraph) is absent from the IDL: the `record_job_outcome` rail was retired per audit-fix F-2026-03 — task_market caller-side severance plus callee removal. Reputation updates now flow through `CategoryReputationUpdated` on the per-capability-bit path, carrying the full 6-dim tuple plus `task_id` for indexer-side dedup.

Field-carrying varies by event class; the pre-edit claim that "all events carry `agent_did` and `timestamp`" is wrong on both axes. `agent_did: [u8; 32]` is present on 12 of 23 events (the 4 lifecycle + 6 stake/slash + 2 reputation). The other 11 are keyed by other identifiers: `operator: Pubkey` on the 3 personhood events (the agent PDA may not exist yet at personhood time — personhood is operator-scoped, not agent-scoped), `program: Pubkey` on the 5 guard events (guard is program-level, not agent-level), or no entity key on the 2 `Global*` events plus `GatekeeperAllowlistUpdated` (program-global state changes). `timestamp: i64` is carried by 20 of 23; the 3 exceptions are `GuardEntered` + `ReentrancyRejected` (both carry `slot: u64` instead — guard-runtime events need the slot for reentrancy DAG ordering) and `GuardAdminReset` (carries a `proposed_at` + `executed_at` pair for the admin-rotation timelock).

## Errors

`Unauthorized`, `Paused`, `InvalidCapability`, `StakeBelowMinimum`, `AgentExists`, `AgentNotFound`, `InvalidStatusTransition`, `SlashPending`, `SlashBoundExceeded`, `TimelockNotElapsed`, `WithdrawalPending`, `NoPendingSlash`, `ArithmeticOverflow`, `InvalidManifest`, `CallerNotTaskMarket`.

## CU budget (§2.1 targets; M1 default, reviewer may tighten)

| Instruction | Target |
|---|---|
| `register_agent` | 50k |
| `update_manifest` | 20k |
| `record_job_outcome` | 15k |
| `delegate_control` / `set_status` | 10k |
| `stake_increase` | 25k |
| `stake_withdraw_request` | 10k |
| `stake_withdraw_execute` | 30k |
| `propose_slash` | 15k |
| `execute_slash` | 35k |

## Invariants

1. `stake_amount` equals `StakeVault` balance at every instruction boundary.
2. `jobs_completed >= jobs_disputed` always.
3. `status == Deregistered` ⇒ account is closed in a future `close_agent` (M2); in M1 it is a terminal live state.
4. `pending_slash.amount <= stake_amount` at proposal and at execution.
5. `executable_at - proposed_at == slash_timelock_secs` at proposal.
6. Reputation dimensions ∈ [0, 10_000].
7. `version` strictly monotonic.
8. Only `operator` can shrink stake; only `authority`/program-PDA can slash.
9. `did` is deterministic; two agents cannot share a DID (PDA seeds guarantee).

## Security checks (backend §5.1)

- **Account Validation:** Anchor seeds + bumps on `RegistryGlobal`, `AgentAccount`, `StakeVault`. Owner = program. Discriminator enforced. `operator` signer checked on all operator instructions.
- **Re-entrancy:** state mutations (stake delta, status update) written before any Token-2022 `transfer_checked` CPI. No CPI back into AgentRegistry from its own paths.
- **Integer Safety:** `checked_add/mul/sub` on `stake_amount`, `jobs_completed`, `jobs_disputed`, reputation EWMA. Slash bound check uses `u128` intermediate.
- **Authorization:** each mutation tagged operator-only, delegate-allowed, or program-only (`task_market.key() == global.task_market_program`).
- **Slashing Safety:** 30-day `slash_timelock_secs` default, `max_slash_bps <= 1000` enforced, appeal window field reserved. Single `pending_slash` at a time prevents stacking.
- **Oracle Safety:** SolRep CPI stubbed in M1; when live, wrap reads in staleness + confidence checks per §5.1.
- **Upgrade Safety:** Squads 4-of-7, 7-day timelock per §2.6.
- **Token Safety:** Token-2022 CPI uses `transfer_checked`. Reject stake mints with `TransferHook` unless whitelisted (M1: plain mint only). TransferHook/ConfidentialTransfer incompatibility documented in code comments.
- **Pause:** `global.paused` blocks all state-changing instructions except `cancel_slash` and authority handoff.

## Invariants to audit-test

- Fuzz: no instruction sequence can produce `stake_amount > StakeVault.amount`.
- Property: slash executed before timelock always fails.
- Property: `update_manifest` with bit outside `approved_mask` always fails.

## Done-checklist

- [ ] All instructions implemented with Anchor accounts + handler tests
- [ ] Integration test: register → update → record 5 outcomes → reputation converges
- [ ] Integration test: propose_slash → 30-day warp → execute_slash transfers the right amount
- [ ] Integration test: withdraw blocked while `pending_slash` active
- [ ] Unauthorized `record_job_outcome` (non-TaskMarket signer) rejected
- [ ] Paused global blocks `register_agent` but allows `cancel_slash`
- [ ] CU measurements logged in `reports/03-agent-registry-anchor.md`
- [ ] IDL at `target/idl/agent_registry.json`
- [ ] `solana-security-auditor` pass against §5.1 checklist; findings closed or explicitly deferred to M2
- [ ] Reviewer gate green
