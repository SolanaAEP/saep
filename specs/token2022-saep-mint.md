# Spec — Token-2022 SAEP Mint (M3)

**Owner:** anchor-engineer + ops (multisig ceremony)
**Depends on:** Squads multisig v4 (4-of-7 emergency council + 6-of-9 program council per §5.2); FeeCollector deployed (TransferHook callback target + PermanentDelegate scope-enforcer + WithheldWithdraw destination); NXSStaking deployed (`apy_authority` PDA derived; rate update path via `NXSStaking::set_apy` CPI'd by GovernanceProgram); GovernanceProgram deployed (`transfer_hook_authority` PDA + meta-governance for extension-authority changes).
**Blocks:** NXSStaking M3 migration (real mint replaces pre-M3 placeholder; separate spec); TaskMarket SAEP-payment path (currently USDC/SOL only per cycle 5 scaffold); FeeCollector TransferHook activation (hook program is set at mint init — FeeCollector can be deployed before mint but TransferHook only "lights up" once mint exists); IACP fee-burn metering (Phase 3 §1.3 burn schedule depends on the mint's TransferFee surface).
**References:** backend PDF §1.3 (Token-2022 extensions enumeration + critical-constraint TransferHook ⊕ ConfidentialTransfer); §2.6 (deployment + upgrade tables — Token-2022 program is upstream-immutable, only mint authority handover is "deployable"); §4.3 (deploy order — mint creation lands AFTER all 6 program upgrade authorities are in Squads + FeeCollector + NXSStaking + GovernanceProgram are live); §5.1 (Token-2022 extension safety checklist: hook program whitelist, MAX_TRANSFER_FEE bound, PermanentDelegate scope enforcement, InterestBearing rate cap, mint inflation-immutability); §5.2 (multisig signer geo-distribution + HSM + ceremony controls); pre-audit-05 (TransferHook program whitelist).

## Goal

The single canonical SAEP token mint. The mint is created once, on mainnet, with a fixed extension set chosen per §1.3. Extension choices are FINAL after `InitializeMint` per Token-2022 semantics — getting init order wrong means re-minting, which means orphaning every issued token. This spec is the executable runbook for that single moment plus the multisig ceremony around it.

The mint is initialized with 6 extensions: TransferHook, TransferFee, PermanentDelegate, InterestBearing, MetadataPointer, Pausable. ConfidentialTransfer is explicitly excluded — incompatible with TransferHook per §1.3 critical-constraint; the Privacy Escrow feature in §1.3 Phase 3 gets a separate mint, out of this spec's scope.

Initial mint authority is held by a single-sig bootstrap signer for atomic init, then transferred to multisig PDAs in a single follow-on tx (T+1, ≤1 slot after init). MintTokens authority is set to None at handover to lock supply; freeze authority is set to None (Pausable replaces it). Each extension's update authority points at the appropriate Squads multisig per §5.2: 6-of-9 program council for non-emergency (TransferFee config, PermanentDelegate, MetadataPointer); 4-of-7 emergency council for Pausable; NXSStaking PDA for InterestBearing rate; GovernanceProgram PDA for TransferHook program ID swaps.

The mint init script (`scripts/init-saep-mint.ts`) is idempotent, has `--dry-run` / `--devnet` / `--mainnet` modes, refuses mainnet without a recent successful devnet rehearsal, and emits a verification report listing on-chain authority Pubkeys post-handover. Mainnet init is a 6-of-9 ceremony per §5.2, geo-distributed, air-gapped bootstrap key, single-use signer destroyed post-handover.

This is not a program. It's an orchestration script + the human ceremony around it. The risk profile is reverse of the program-spec ones: fewer LOC, but every line is high-blast-radius — a misordered ix means re-minting, and re-minting means relaunching the protocol.

## Mint configuration

### Decimals
- `decimals: 9` — matches SOL convention. InterestBearing math is identical at any decimal count (extension stores u128 internally), so decimals choice is purely display-side.

### Metadata (via MetadataPointer + Token Metadata Interface)
- `name: "SAEP"`
- `symbol: "SAEP"`
- `uri: ipfs://<CID>` — pinned `metadata.json` with full token description, image, properties; CID locked at T-3d config-freeze
- `additional_metadata: []` — reserved; governance can add fields post-launch via `token_metadata_update_field` (e.g., `governance_program_id`, `bookkeeping_program_id`)

The MetadataPointer extension self-references (`metadata_address: mint_address`) — metadata stored inline rather than in a separate Metaplex account. Saves rent (~0.0014 SOL per holder) and removes one external dependency at read-time per §1.3.

### Initial supply
- `initial_supply: 0`
- Mint authority transferred to None at handover (T+1) via `set_authority(MintTokens, None)`
- Rationale: §5.1 inflation-immutability. Future inflation requires meta-governance + a separate `EmissionsScheduler` program holding mint authority — neither in M3 scope. Stakers earn via InterestBearing accrual on the mint extension (no actual minting), not via supply expansion.
- Migration path: if M4+ requires controlled emissions, mint authority cannot be re-acquired (one-way None). The path forward is governance-CPI-driven via a wrapper / wrap-mint pattern; documented as M4+ Open Question, not a M3 reversal.

## Extensions

### 1. TransferHook
- **hook_program_id:** `FeeCollector` program (`SAEPfee1111...` per §2.1)
- **authority (post-handover):** `GovernanceProgram` PDA seeds `[b"transfer_hook_authority"]`. Authority can be set to None post-launch via meta-governance to make the hook program permanent.
- **Init pre-condition:** FeeCollector MUST be deployed and the program executable BEFORE mint init; init script validates via `getAccountInfo(feeCollectorProgramId)` that `executable == true` and `owner == BPFLoaderUpgradeable`.
- **Callback contract:** Per pre-audit-05 — FeeCollector exposes `transfer_hook(source, mint, destination, owner, amount, extra_accounts)`; extra accounts include `HookAllowlist`, optional `AgentHookAllowlist`, fee-pool ATA. FeeCollector enforces hook-program-whitelist for tokens that ARE transferred (recursive case where SAEP transfers another Token-2022 mint with its own hook); collects 0.1% protocol fee per §1.3.
- **Failure mode:** If FeeCollector reverts the hook ix, the source transfer reverts. This IS the gate; intentional. Maintenance requires governance-approved hook program upgrades via Squads (the FeeCollector program upgrade authority is the 6-of-9 program council).
- **Compatibility:** Self-transfers (mint → mint operations like `mint_to`, `burn`) do NOT invoke the hook per Token-2022 spec; only `transfer` / `transfer_checked` invoke it. Verified against `spl-token-2022` v6.x.

### 2. TransferFee (built-in)
- **transfer_fee_basis_points:** 10 (0.1%, matches §1.3)
- **maximum_fee:** `1_000_000 * 10^decimals` (1M SAEP per tx; bounds whales paying 10%+ of supply per tx)
- **transfer_fee_config_authority (post-handover):** Squads 6-of-9 program council (per §5.2 — fee parameter changes are non-emergency, take meta-governance)
- **withdraw_withheld_authority (post-handover):** `FeeCollector` PDA seeds `[b"transfer_fee_withdraw_authority"]` — FeeCollector CPI sweeps withheld fees on each settlement cycle into the protocol fee pool.
- **Note on double-counting:** TransferHook callback collects 0.1% protocol fee at hook time (sent to fee-pool ATA inside the hook tx). TransferFee built-in collects ANOTHER 0.1% at the protocol level (held in token-account WithheldFees state, swept later). Net effective fee = 0.2% per §1.3. Confirmed not double-counting because hook fee goes to fee-pool ATA inline; withheld fee accumulates per-account until `FeeCollector::sweep_withheld_fees` withdraws.

### 3. PermanentDelegate
- **delegate (post-handover):** `FeeCollector` program PDA seeds `[b"permanent_delegate"]`
- **Scope:** Per §1.3 "FeeCollector program as permanent delegate enables fee sweep without owner interaction" — used for stale-fee sweeps from inactive accounts.
- **Critical (audit attention):** PermanentDelegate is god-mode on every token account holding the mint. `FeeCollector::sweep_inactive(account, mint)` MUST validate (a) `account.last_active < now - inactivity_threshold` (default 90 days, governance-tunable), (b) swept amount ≤ `withheld_fees + protocol_dust_threshold`, never user balance principal. Test surface is FeeCollector spec, not this spec — but the contract is cited here as the security covenant this mint depends on.
- **Authority (post-handover):** Squads 6-of-9 program council; can be set to None post-launch via meta-governance to remove permanent-delegate completely (one-way switch at the cost of losing inactive-account sweep).

### 4. InterestBearing
- **rate_authority (post-handover):** `NXSStaking` program PDA seeds `[b"apy_authority"]` per the NXSStaking spec. NXSStaking owns the PDA; `NXSStaking::set_apy` is callable only from GovernanceProgram CPI (`gov_program_id == config.governance_program`) per cycle 64.
- **initial_rate:** 0 bps (no APY at launch; first APY-set proposal lands via GovernanceProgram after audits clear)
- **Accrual:** Per §1.3 InterestBearing is a Token-2022 native feature. Yield is computed at read-time via `amount_to_ui_amount(amount, decimals, current_unix_ts)`; no minting happens. Stakers see growing displayed balance without claim-required.
- **Cap (defense-in-depth):** NXSStaking::set_apy enforces `|apy_basis_points| ≤ 1000` (10% max APY; ratchet via meta-governance per NXSStaking spec). The mint extension itself accepts any i16; the cap is enforced at the CPI authority level.
- **Pre-M3 placeholder:** NXSStaking ships against a generic SPL mint without InterestBearing per its spec; M3 migration to this mint is documented in a separate NXSStaking-M3-migration spec. Out of this spec's scope; flagged so the M3 cycle plan accounts for the migration.

### 5. MetadataPointer
- **metadata_address:** `mint_address` (self-referential; stores metadata inline)
- **authority (post-handover):** Squads 6-of-9 program council (metadata updates are non-emergency)
- **Initial metadata:** name/symbol/uri per §Mint configuration above
- **Init order constraint:** `metadata_pointer_initialize` MUST precede `initialize_mint`; `token_metadata_initialize` MUST follow `initialize_mint` (the metadata-init ix writes through the pointer, which requires the pointer extension to be registered AND the mint to be initialized).

### 6. Pausable
- **pause_authority (post-handover):** Squads 4-of-7 emergency council (per §1.3 + §5.2)
- **State at init:** unpaused
- **Activation policy:** Per §1.3 "Used for critical exploit response only". Pause halts all transfers protocol-wide (TransferHook, TransferFee, InterestBearing-display, NXSStaking, AgentRegistry, TaskMarket settlement all gate on pause). Pre-pause escrows remain locked (state-machine reads unaffected; mutation-instructions revert).
- **Auto-thaw:** Token-2022 Pausable has no auto-thaw; council must explicitly unpause. GovernanceProgram emergency category §2.6 mirrors this at the program level (14d auto-thaw), but the mint pause itself is council-revertible only — adds defense-in-depth against a compromised governance contract pause-spamming the mint.
- **Why init-time even if rarely used:** Token-2022 extensions are FINAL after `initialize_mint`. If Pausable isn't initialized at mint creation, it can NEVER be added. Spec initializes it now to preserve the option; activation is a separate governance event.

## Excluded extensions (and why)

### ConfidentialTransfer
- **Reason:** Per §1.3 critical-constraint, ConfidentialTransfer + TransferHook CANNOT coexist in Token-2022 (mutually exclusive at extension layer). SAEP chose TransferHook (protocol fee + whitelist enforcement); confidential transfers therefore impossible on the SAEP mint.
- **Privacy Escrow at M4+:** Separate mint per §1.3 Phase 3 reference. That mint will have ConfidentialTransfer + NO TransferHook — enabling private balances at the cost of no per-tx fee enforcement. Out of this spec's scope; documented as Open Question for forward planning.

### CpiGuard
- **Reason:** SAEP relies on multi-program CPIs throughout (TaskMarket → ProofVerifier → AgentRegistry → TreasuryStandard chain). Mint-level CpiGuard would block legitimate cross-program calls. Token-account-level CpiGuard remains opt-in for individual users via SAEP-agnostic Token-2022 ixs.

### MemoTransfer
- **Reason:** No requirement; portal-level memo via SPL-Memo v2 covers IACP envelope-anchoring use case (per IACP anchor cycle 56). Adding MemoTransfer would force every transfer to carry a memo, breaking the gas profile.

### NonTransferable
- **Reason:** SAEP is fungible governance + utility token. Soulbound semantics not in scope.

### ImmutableOwner
- **Reason:** Owner-changes are useful for treasury rotation; immutable owner would block the use case. Per-account opt-in remains available to end-users.

## Init order

Token-2022 requires extensions initialized BEFORE `initialize_mint`. Order of extension-inits among themselves matters less but the pre/post-mint split is hard:

1. `system_program::create_account` — allocate the mint account with size = `Mint::base_size + Σ(extension sizes)`. Compute via `ExtensionType::try_calculate_account_len::<Mint>(&[TransferHook, TransferFee, PermanentDelegate, InterestBearing, MetadataPointer, Pausable])`. Pre-allocates exact rent; avoids realloc.
2. `metadata_pointer_initialize(metadata_address: mint_pubkey, authority: bootstrap_signer)` — pre-mint
3. `transfer_fee_initialize(transfer_fee_config_authority: bootstrap, withdraw_withheld_authority: bootstrap, transfer_fee_basis_points: 10, maximum_fee: 1_000_000 * 10^9)` — pre-mint
4. `transfer_hook_initialize(authority: bootstrap, program_id: fee_collector_program_id)` — pre-mint; FeeCollector must be deployed
5. `permanent_delegate_initialize(delegate: bootstrap)` — pre-mint
6. `interest_bearing_initialize(rate_authority: bootstrap, rate_bps: 0)` — pre-mint
7. `pausable_initialize(authority: bootstrap)` — pre-mint
8. `confidential_transfer_initialize` — SKIP (incompatible with TransferHook per §1.3)
9. `initialize_mint(decimals: 9, mint_authority: bootstrap, freeze_authority: bootstrap)` — finalizes; extension set is now FROZEN
10. `token_metadata_initialize(name, symbol, uri, mint_authority: bootstrap, update_authority: bootstrap)` — post-mint; writes metadata inline via the self-referential pointer

Steps 1-9 MUST be a single atomic transaction. If any step fails, the partial-init mint is unusable (size + ext-state mismatch); the whole tx must revert. Step 10 can be a follow-on tx but MUST land before handover (T+1) to avoid a metadata-less mint window where indexers see an unnamed token.

The init tx is bounded at ~80k CU per ix × 9 ixs = ~720k CU baseline; with `ComputeBudgetProgram::set_compute_unit_limit(1_400_000)` we have headroom. Realistic measurement: ~600k CU on devnet rehearsal. Single-tx init fits the 1.4M CU per-tx ceiling.

## Authority handover sequence

### Init transaction (T+0)
- All 6 extension authorities + mint authority + freeze authority held by bootstrap signer
- Single-sig (bootstrap) for atomicity. Multisig signer aggregation across 6 sigs in a 9-ix-tx is feasible but operationally fragile at ceremony time; single-sig + immediate handover is the cleaner pattern.

### Metadata transaction (T+0, +1 slot)
- Step 10 above; writes name/symbol/uri inline via metadata pointer
- Optional: can be bundled with handover tx if total ix count + size fits within tx limit (1232 bytes after sigs); kept separate by default for tx-size safety margin

### Handover transaction (T+1, ≤1 slot after init)
All `set_authority` calls in a SINGLE atomic tx. Partial handover is a security incident.

- `set_authority(MintTokens, None)` — locks initial supply at 0 forever; reverses inflation per §5.1
- `set_authority(FreezeAccount, None)` — no admin freezing; Pausable replaces (per-account freeze is a different threat model not in M3 scope)
- `set_authority(TransferFeeConfig, squads_6of9_program_council)` — meta-governance for fee changes
- `set_authority(WithheldWithdraw, fee_collector_withdraw_pda)` — FeeCollector sweeps withheld fees
- `set_authority(TransferHookProgramId, governance_transfer_hook_authority_pda)` — meta-governance can swap hook
- `set_authority(PermanentDelegate, squads_6of9_program_council)` — meta-governance can revoke (one-way to None)
- `set_authority(InterestBearingRateAuthority, nxs_staking_apy_authority_pda)` — NXSStaking owns rate; gov CPIs through `NXSStaking::set_apy`
- `set_authority(MetadataPointerAuthority, squads_6of9_program_council)` — meta-governance for metadata-pointer changes
- `set_authority(MetadataUpdateAuthority, squads_6of9_program_council)` — same council for metadata-field updates (could split per Open Q #6)
- `set_authority(PausableAuthority, squads_4of7_emergency_council)` — emergency council per §5.2

Handover MUST be one atomic tx. Partial handover means bootstrap signer holds god-mode for an unbounded window — a security incident if the bootstrap key is compromised between init and handover. Mitigation per §5.2: handover tx is pre-signed at ceremony time; broadcast is automatic on init confirmation; bootstrap key is air-gapped and destroyed post-handover.

### Verification transaction (T+2, ≤5 minutes after handover)
- Read-only: `getMint(mint, programId: TOKEN_2022_PROGRAM_ID)` + `getAccountInfo(mint)` extension parse
- Assert each authority Pubkey matches expected (per `state/saep-mint-mainnet-config.json` SHA-256-attested at T-3d)
- Assert MintTokens authority is None
- Assert MetadataPointer.metadata_address == mint_pubkey
- Assert TransferHook.program_id == fee_collector_program_id
- Output `reports/saep-mint-handover-mainnet.md` with on-chain authority dump, init tx sig, handover tx sig, verification slot

## Init script — `scripts/init-saep-mint.ts`

### Modes

- `--dry-run` (default): runs full init against an in-memory simulated cluster (e.g., `solana-test-validator` started in-process); prints all 9 ixs; signs locally; simulates via `simulateTransaction`. Asserts post-init extension state. Does not transmit. Used in CI to catch ix-shape regressions when `@solana/spl-token` or `spl-token-2022` upstream changes.
- `--devnet`: full init against devnet; produces a permanent rehearsal mint. Used for portal/SDK integration testing pre-M3 + as the rehearsal-precondition for mainnet.
- `--mainnet`: full init against mainnet. Requires `--confirm-mainnet` flag AND `SAEP_MAINNET_INIT_KEY` env var pointing at the air-gapped bootstrap keypair. Refuses if (a) bootstrap signer balance < `2 * estimated_init_cost`, (b) most recent successful `state/saep-mint-devnet.json` is older than 7 days, (c) extension-config SHA-256 in mainnet-config.json doesn't match the council-attested hash, (d) FeeCollector / NXSStaking / GovernanceProgram are not deployed at expected pubkeys on mainnet.

### Idempotence

- Script reads `state/saep-mint-{network}.json` first; if mint pubkey present, refuses to re-init unless `--force-reinit-rehearsal` AND `--devnet` (mainnet re-init is impossible by design — the mint pubkey is final).
- After init, writes `state/saep-mint-{network}.json` with mint pubkey + bootstrap signer + init tx sig + handover tx sig + slot + extension-config SHA-256.

### Rehearsal contract

- Mainnet init MUST be preceded by ≥1 successful `--devnet` run within 7 days, validated by the `state/saep-mint-devnet.json` timestamp + matching extension-config SHA-256.
- Spec rationale: §1.3 "Extension choices are final" — one rehearsal cycle catches misordered ixs / version-skewed `spl-token-2022` shape changes before mainnet.

### Output

- `reports/saep-mint-init-{devnet|mainnet}.md` — init tx sig, handover tx sig, verification slot, post-handover authority dump, total CU consumed, total rent, total fee.
- Console: mint pubkey + Solscan link.

## Multisig ceremony (mainnet only)

Per §5.2, mainnet init is a ceremony, not a script-run. Steps:

- **T-7d:** Devnet rehearsal run; verify report; sign-off from anchor-engineer + ops.
- **T-3d:** Mainnet config frozen — extension set, all 10 authority Pubkeys, metadata URI, decimals, all in `state/saep-mint-mainnet-config.json`. SHA-256 of the file is signed by all 6 program-council signers (out-of-band signature, e.g., signed-message or PGP-detached) and stored in the council's air-gapped vault. The script checks this signed hash before allowing `--mainnet`.
- **T-1d:** Final dry-run against devnet using mainnet-config.json (rehearsal mint pubkey replacement); validates the config still works against current Token-2022 program version (upstream may have shifted extension semantics between rehearsal and ceremony).
- **T+0 (ceremony):** All 6 program-council signers convene, geo-distributed per §5.2 (≥4 in different jurisdictions). Bootstrap signer keypair generated air-gapped at ceremony time (single-use). Init tx + metadata tx + handover tx broadcast in 3 consecutive blocks (or bundled atomically via Jito if the tx-size + sig-count fits — see Open Q #2). Bootstrap signer key is destroyed post-handover (memwipe of process memory + secure-delete of any keypair file + the air-gapped device is reformatted).
- **T+1d:** Verification report published on internal repo; signed attestation from each of the 6 signers acknowledging the on-chain authority Pubkeys match the T-3d config.

## Security checks

(Per backend §5.1 checklist for Token-2022 + ceremony controls)

- **Extension safety:** All 10 extension authorities point to either a multisig PDA or None at handover-completion. No extension authority is an EOA at T+1.
- **TransferHook authority:** Settable to None post-launch via meta-governance to make hook program permanent; reviewed at M4 (out of M3 scope). Default at M3: governance can swap hook program (allows audit-driven hook upgrades).
- **PermanentDelegate scope:** Defense lives in FeeCollector — `FeeCollector::sweep_inactive` validates `last_active < now - inactivity_threshold` AND swept amount ≤ `withheld_fees + protocol_dust`. The mint extension itself trusts the delegate; this spec depends on FeeCollector correctness as the only check between protocol and user funds.
- **InterestBearing rate cap:** NXSStaking::set_apy enforces `|apy_basis_points| ≤ 1000`. Mint extension accepts arbitrary i16; cap is at the CPI authority level. Meta-governance can ratchet the cap higher per NXSStaking spec.
- **TransferFee maximum_fee bound:** 1M SAEP per tx; meta-governance can raise. Prevents whale txs paying disproportionate fees.
- **Pausable scope:** Council pause halts ALL transfers including settlement releases. Pre-pause escrows are not refunded (intentional — pause is for incident response, refunds happen post-incident via separate governance proposals).
- **MetadataPointer self-reference:** `metadata_address == mint_address`; cannot be hijacked to point at attacker-controlled metadata account post-init (would require MetadataPointerAuthority signature, held by 6-of-9).
- **Mint inflation immutability:** `set_authority(MintTokens, None)` at T+1 makes future inflation impossible at the mint level. Any future inflation requires a new mint + protocol relaunch — high enough cost to deter casual emission proposals.
- **Bootstrap signer destruction:** memwipe + key file deletion + air-gapped device reformatted. Ceremony device NEVER touches network-connected hardware. Protects against post-ceremony key recovery from disk forensics or compromised laptop.
- **Single-block init+metadata+handover:** if any of the 3 txs land out of order or one fails, the mint is in an intermediate state. Bootstrap signer holds god-mode authorities until handover lands. Acceptable risk window: ≤3 slots if sequenced; ≤1 slot if Jito-bundled. Mitigation: handover tx is pre-signed at ceremony; broadcast is automatic on init confirmation; if handover fails, the council immediately re-proposes (bootstrap signer key is offline at this point per ceremony script, but exists on-disk on the air-gapped device until ceremony-end memwipe, so a re-broadcast is feasible within the ceremony window).
- **No freeze authority backdoor:** `set_authority(FreezeAccount, None)` removes the per-account freeze surface entirely; Pausable is the only freeze-equivalent. Prevents a compromised freeze authority from selectively freezing whale accounts.

## CPI contract (what this mint exposes to other programs)

- **TransferHook callback:** `FeeCollector::transfer_hook(source, mint, destination, owner, amount, extra_accounts)` — invoked on every `transfer` / `transfer_checked`; FeeCollector enforces 0.1% fee + hook-allowlist per pre-audit-05.
- **TransferFee withdraw:** `FeeCollector::sweep_withheld_fees(mint, accounts[])` — sweeps `WithheldWithdraw`-authority-locked fees from per-account state to FeeCollector pool. Authority is FeeCollector PDA; FeeCollector signs as the withdraw authority via PDA seeds.
- **PermanentDelegate transfer:** `FeeCollector::sweep_inactive(account, mint)` — uses PermanentDelegate to claim withheld fees from inactive accounts. Validation in FeeCollector per §Security checks PermanentDelegate scope.
- **InterestBearing rate update:** `NXSStaking::set_apy(rate_bps)` — CPIs Token-2022 `interest_bearing_update_rate(mint, rate_authority_pda, rate)` via NXSStaking's apy_authority PDA. Callable only from GovernanceProgram CPI to NXSStaking per cycle 64 NXSStaking spec.
- **Pausable trigger:** Squads 4-of-7 council directly invokes `pause(mint, pause_authority)`; no program-CPI; emergency human-signed.
- **Metadata update:** Squads 6-of-9 council directly invokes `token_metadata_update_field(mint, metadata_authority, field, value)`; non-emergency, used for URI rotations or `additional_metadata` adds.
- **Mint authority:** None post-handover. No CPI surface. New tokens cannot be minted.
- **Freeze authority:** None post-handover. No CPI surface. Per-account freeze unavailable.

## Devnet bring-up

Per §4.3 deploy order, mint creation is sequenced AFTER:

1. All 6 program upgrade authorities migrated to Squads multisigs (program-level lockdown per §5.2).
2. FeeCollector deployed + `HookAllowlist` initialized + SAEP mint pubkey pre-allocated (so `transfer_hook_initialize` can reference). Pre-allocation is via the bootstrap-signer keypair: the mint pubkey is known once the keypair is generated; FeeCollector references it as a constant in its allowlist.
3. NXSStaking deployed + `apy_authority` PDA derived (for `interest_bearing_initialize` rate_authority handover).
4. GovernanceProgram deployed + `transfer_hook_authority` PDA derived (for `transfer_hook_initialize` authority handover).

Devnet rehearsal mint is created with all 6 extensions but bootstrap-signer-authority everywhere (no multisig handover for devnet — devnet single-sig is operationally simpler and devnet mint has no real value). NXSStaking M3 migration uses the rehearsal mint to validate the M3 mint-swap path before mainnet ceremony (separate spec).

Per §4.3 48h timelock override, devnet mint init is NOT timelock-gated — only param-changes via governance go through the override. Init is one-shot.

## Open questions for reviewer

1. **Mint authority disable vs governance-controlled emissions.** Spec defaults to disabled (None at T+1, no further supply). Alternative: hand mint authority to a governance-controlled PDA + introduce an `EmissionsScheduler` program at M4 for controlled emissions (e.g., 2% annual). Disable now, add later via meta-governance? Or keep the option open from day 1? Picked disable for inflation-immutability simplicity; flagged because re-acquisition is one-way-impossible.
2. **Single-block init + metadata + handover via Jito bundle vs sequenced txs.** Bootstrap signer holds god-mode authorities for ≤3 slots if sequenced; ≤1 slot if Jito-bundled. Reviewer may want bundled atomicity (eliminates the partial-handover window) at the cost of ceremony complexity (Jito searcher dependency at ceremony time).
3. **PermanentDelegate scope.** Token-2022 PermanentDelegate is god-mode on every token account. FeeCollector enforcement is the only check. Reviewer should confirm pre-audit-05 + FeeCollector spec are sufficient defense, OR push for `set_authority(PermanentDelegate, None)` at T+1 (eliminates the extension entirely) at the cost of losing inactive-account sweep capability. Trade-off: most protocol fees are recoverable via TransferFee WithheldWithdraw; PermanentDelegate is only needed for the long-tail inactive case.
4. **TransferFee maximum_fee bound.** 1M SAEP per tx may be too low or too high; depends on circulating supply at M3 launch. Reviewer to set to a sane fraction (default 0.1% of expected initial supply at M3).
5. **Pausable auto-thaw.** Token-2022 Pausable has no auto-thaw; council can hold pause indefinitely (single point of failure if council compromised). Reviewer may want a meta-governance auto-unpause after N days, implemented via a watcher program calling `unpause` after a timeout when the council fails to renew. Not in M3 scope; flagged for M4.
6. **MetadataPointer + MetadataUpdate authority split.** Post-launch, metadata updates require 6-of-9 sig — slow for routine URI rotations. Reviewer may want a separate `metadata_authority` Squads (e.g., 3-of-5 ops council) for ergonomic URI updates while major fields require 6-of-9. Default keeps both at 6-of-9 to avoid council proliferation.
7. **Mint pubkey vanity prefix.** Solana convention is vanity prefixes for canonical mints (e.g., `So111...` wrapped SOL, `EPjFW...` USDC). Bootstrap signer can grind a `SAEP...` prefix; takes ~1-4 hrs of CPU per character with `solana-keygen grind --starts-with SAEP:1`. Spec defaults to no-vanity (mint pubkey is whatever the bootstrap keypair generates) for ceremony-time simplicity. Reviewer may want vanity grind as a pre-ceremony step (T-7d).
8. **Decimals = 9 vs 6.** SOL is 9, USDC is 6. SAEP picks 9 for SOL-convention; portal display uses scientific notation past ~10^12. Reviewer may want 6 to match USDC for cross-mint display consistency. Not reversible after init.
9. **InterestBearing initial rate = 0.** Launch with zero APY; first APY-set proposal post-audit clears it. Alternative: bootstrap a non-zero rate at init (e.g., 5% APY) so stakers see immediate yield. Picked zero to keep mint init unentangled from APY-setting governance and to avoid pre-audit yield commitments.
10. **Phase 3 Privacy Escrow separate mint.** Out of this spec's scope but referenced by §1.3. Should be its own spec doc when planned. Reviewer to confirm M3 scope is mint-only without committing to the Phase-3 separate-mint design (it would have ConfidentialTransfer + NO TransferHook — different threat model entirely).

## Done checklist

- [ ] `scripts/init-saep-mint.ts` lands; supports `--dry-run`, `--devnet`, `--mainnet`; idempotent with state file
- [ ] CI runs `--dry-run` on every push to catch upstream `spl-token-2022` shape regressions
- [ ] FeeCollector deployed to devnet + `HookAllowlist` initialized + SAEP mint pubkey pre-allocated
- [ ] NXSStaking deployed to devnet + `apy_authority` PDA derived + verified
- [ ] GovernanceProgram deployed to devnet + `transfer_hook_authority` PDA derived + verified
- [ ] Devnet rehearsal mint init succeeds; all 6 extensions verified post-init
- [ ] Devnet rehearsal handover succeeds (single-sig devnet variant); all authorities at expected Pubkeys
- [ ] Devnet metadata tx succeeds; `name == "SAEP"`, `symbol == "SAEP"`, `uri` matches CID
- [ ] Devnet NXSStaking M3 migration tested against rehearsal mint (separate spec, blocking)
- [ ] `state/saep-mint-mainnet-config.json` frozen at T-3d + 6-of-9 council SHA-256 attestation in vault
- [ ] T-1d final devnet dry-run against mainnet config succeeds (validates current Token-2022 program shape)
- [ ] T+0 mainnet ceremony: init tx + metadata tx + handover tx confirmed within ≤3 slots
- [ ] T+0 bootstrap signer destroyed (memwipe + secure-delete + device reformat)
- [ ] T+1d verification report published; 6-of-9 signed attestation matches on-chain authority Pubkeys
- [ ] OtterSec / Halborn audit confirms mint config matches spec
- [ ] Mint pubkey announced in `apps/docs` + portal + IACP discovery feed
- [ ] FeeCollector TransferHook callback live on devnet + 100 test transfers succeed with correct fee deduction
- [ ] Portal SDK detects mint, reads InterestBearing accrual via `amount_to_ui_amount`, displays growing balance correctly
