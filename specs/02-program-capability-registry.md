# Spec 02 — CapabilityRegistry Program

**Owner:** anchor-engineer
**Depends on:** 01
**Blocks:** 03 (AgentRegistry validates capability bitmasks against this registry)
**References:** backend PDF §2.1 (capability_mask is u128, 128 tags max), §2.2 (register_agent validates capability_mask against CapabilityRegistry approved bitmask), §2.6 (7-day timelock on upgrades), §5.1 (Authorization, Account Validation)

## Goal

A governance-gated on-chain registry of capability tags. Agents declare skills as a u128 bitmask; this program is the single source of truth for which bits are currently approved. M1 seeds 32 initial tags covering the Phase-1 agent surface (retrieval, code-gen, image-gen, inference, data-cleaning, scraping, moderation, routing, pricing, escrow-ops, etc.). Further tags are added only by governance.

Backend §2.2 shows AgentRegistry will CPI-read the registry during `register_agent` and `update_manifest`. This spec defines the storage and governance path; §2.2's consumption is implemented in spec 03.

## State

### `RegistryConfig` PDA — global singleton
- **Seeds:** `[b"config"]`
- **Fields:**
  - `authority: Pubkey` — GovernanceProgram authority (in M1, placeholder multisig; switched to governance PDA in M2)
  - `approved_mask: u128` — bitmask of currently approved tags
  - `tag_count: u8` — number of tags defined (monotonic; max 128)
  - `pending_authority: Option<Pubkey>` — two-step authority transfer
  - `paused: bool` — emergency pause
  - `bump: u8`

### `CapabilityTag` PDA — one per tag; fixed-layout, mutation paths enumerated in §Instructions
- **Seeds:** `[b"tag", &[bit_index]]`
- **Fields:**
  - `bit_index: u8` — 0..127
  - `slug: [u8; 32]` — ASCII lowercase identifier, null-padded ("code_gen", "retrieval_rag", …)
  - `manifest_uri: [u8; 96]` — Arweave/IPFS URI describing the tag (schema, expected inputs/outputs)
  - `added_at: i64`
  - `added_by: Pubkey` — authority that approved it
  - `retired: bool` — set by governance to soft-remove without reusing the bit
  - `bump: u8`

Account size fixed. No `String` on-chain; everything is fixed-width for rent determinism.

### Scaffold-vs-spec deltas (cycle 175, 2026-04-19)

§State reconciliation against `programs/capability_registry/src/state.rs`. Pre-edit enumeration covered 6 `CapabilityTag` fields; scaffold ships 7 (6 spec'd + 1 absent field) + 3 module-level tier constants absent from the spec's state surface entirely. Pairs with the cycle-172 §Instructions deltas block (line 86 above): the new ix `set_tag_personhood` needs the new field to mutate + the 3 constants to bound-check `min_tier`. Opens the cross-spec §State-sweep arc (first landing; (al-3) agent-registry §State + (al-6) proof-verifier §State queued).

- **Absent field (1) — `CapabilityTag.min_personhood_tier: u8`** at `state.rs:32` between `retired: bool` and `bump: u8`. **Load:** minimum personhood tier required to bid on tasks gated by this capability. **Init value:** `0` (= `PERSONHOOD_TIER_NONE`) on `propose_tag.rs:58` — all tags default to no-gate at creation; governance opts a tag into gating post-facto via `set_tag_personhood`. **Mutated by:** `set_tag_personhood_handler` at `set_tag_personhood.rs:38` (the sole mutation path; `propose_tag` writes the default; `update_manifest_uri` + `retire_tag` do not touch it). **Consumed by:** agent_registry `register_agent` + `update_manifest` (reads, no CPI back; `state.rs:32` doc comment: "mirrors agent_registry::state::PersonhoodTier ... Encoded as u8 to avoid a CPI-level type dep on agent_registry"). Landed `b435db7` (2026-04-16, "programs: personhood gate (#4) + token-2022 hook allowlist (#5)") per `specs/pre-audit-04-personhood-gate.md`. Ordered between `retired` and `bump` in the Anchor `#[account]` struct — on-wire offset-stable for indexer decoders only if the pre-`b435db7` scaffold never shipped (it did not reach localnet indexer fixtures per cycle 172 §Events reconciliation).
- **Absent constants (3) — personhood-tier ladder** at `state.rs:36-38`, module-level `pub const`s: `PERSONHOOD_TIER_NONE: u8 = 0` (default on `propose_tag`; no-gate), `PERSONHOOD_TIER_BASIC: u8 = 1` (Civic basic-tier attestation accepted), `PERSONHOOD_TIER_VERIFIED: u8 = 2` (upper bound enforced by `set_tag_personhood` validation `min_tier ≤ PERSONHOOD_TIER_VERIFIED`). Ladder mirrors `agent_registry::state::PersonhoodTier` enum by deliberate u8-duplication (decoupling callout above). §State pre-edit has no "Constants" subsection; held for a future cross-spec pass if constants become a recurring §State surface.
- **Intent-drift surfaced inline — "immutable after init" claim is stale.** Pre-edit spec line 26 heading `CapabilityTag` PDA — one per tag, **immutable after init** was accurate at cycles 155-171 (only `retired: bool` flip via `retire_tag` + `manifest_uri` overwrite via `update_manifest_uri` mutated the struct post-init; both already-documented exceptions). Post-`b435db7` the claim is false: `min_personhood_tier` is field-level mutable via `set_tag_personhood`, and the header claim would otherwise mislead a reviewer reading the §State block in isolation. Not patched in this cycle's scope (header edit is a §State-intro-rewrite, not a deltas-append, and cycles 155-173 have established the append-only convention for reconciliation); flagged as a single-line follow-up candidate for the §State-intro-refresh cycle that eventually lands the "post-M1 tier-ladder expansion" callout alongside.
- **Guard-admin parity (no change from cycle 172):** capability_registry has no `GuardConfig` / `AllowedCallers` / `ReentrancyGuard` PDAs by design (no CPI-out surface beyond `validate_mask` readonly view). 5-program guard-state-vocabulary matrix row = `N/A`, consistent with the cycle-172 guard-ix-vocabulary row. Unlike the 4 sister M1-in-scope programs (treasury / dispute / task-market / agent-registry / proof-verifier §State blocks — each carries the 3-PDA guard-state triplet absent from their pre-edit §State enumeration), capability_registry's §State scope is fully reconciled by this 1-field + 3-constant addition.
- **M1 §State arc state post-cycle:** 1-of-5 M1-in-scope programs reconciled (capability_registry this cycle). Remaining 4 candidates queued per cycle 174's (al-3) + (al-6) framing plus implied (al-2) treasury_standard + (al-4) task_market + (al-7) dispute_arbitration follow-ons — each has guard-state-triplet absent blocks that cycles 163/166/167 surfaced inline when landing their §Instructions reconciliations. Smallest delta landed first per cycles 172 discipline; larger multi-PDA sweeps carry forward.

### §State-intro-refresh (cycle 183, 2026-04-19)

Clears the cycle-175 intent-drift held at line 45 above. Pre-edit header at line 26 read `CapabilityTag` PDA — one per tag, **immutable after init**; post-edit reads `CapabilityTag` PDA — one per tag; fixed-layout, mutation paths enumerated in §Instructions. Three post-init mutation paths exist in-scaffold: `retire_tag.rs` flips `retired: bool`, `update_manifest_uri.rs` overwrites `manifest_uri: [u8; 96]`, `set_tag_personhood.rs` writes `min_personhood_tier: u8` (cycle-175 absent-field landing). "Fixed-layout" preserves the original intent — account size + field offsets are rent-deterministic + indexer-decode-stable — without the false "immutable" claim. §Instructions subsections already enumerate each mutation path; reviewer cross-reading the header lands on the right section rather than bouncing between the stale claim and the documented exceptions.

## Instructions

### `initialize(authority: Pubkey)`
- **Signers:** deployer (one-shot; rejects if `RegistryConfig` already exists)
- **Writes:** creates `RegistryConfig` with `authority`, `approved_mask = 0`, `tag_count = 0`, `paused = false`
- **CPI:** none
- **Emits:** `RegistryInitialized`

### `propose_tag(bit_index: u8, slug: [u8; 32], manifest_uri: [u8; 96])`
- **Signers:** `authority`
- **Validation:**
  - `bit_index < 128`
  - `CapabilityTag` PDA for this index does not already exist
  - `slug` is ASCII lowercase (`a-z`, `0-9`, `_`), length ≥ 1, no leading/trailing `_`
  - `manifest_uri` non-empty
  - `!paused`
- **State transition:** creates `CapabilityTag`, sets bit in `RegistryConfig.approved_mask` via `checked bit-set`, increments `tag_count`
- **Emits:** `TagApproved { bit_index, slug, added_by }`

### `retire_tag(bit_index: u8)`
- **Signers:** `authority`
- **Validation:** tag exists, not already retired, `!paused`
- **State transition:** sets `retired = true`; clears the bit in `approved_mask`. Bit is NOT reused; existing agents whose `capability_mask` has this bit remain valid but new registrations reject it.
- **Emits:** `TagRetired { bit_index }`

### `update_manifest_uri(bit_index: u8, manifest_uri: [u8; 96])`
- **Signers:** `authority`
- **Validation:** tag exists, not retired
- **State transition:** overwrites `manifest_uri`. Slug and bit_index immutable.
- **Emits:** `TagManifestUpdated`

### `transfer_authority(new_authority: Pubkey)`
- **Signers:** `authority`
- **Effect:** sets `pending_authority`. Two-step to avoid locking out on typo.

### `accept_authority()`
- **Signers:** `pending_authority`
- **Effect:** promotes `pending_authority` → `authority`, clears pending.

### `set_paused(paused: bool)`
- **Signers:** `authority`
- **Effect:** toggles pause. While paused, only `set_paused` and authority transfer succeed.

### `validate_mask(mask: u128) -> Result<()>` — view helper used by AgentRegistry CPI
- **Readonly.** Confirms `(mask & !approved_mask) == 0`. Returns `InvalidCapability` otherwise.
- AgentRegistry may re-implement the check inline by reading `RegistryConfig` to save the CPI overhead; the view exists for off-chain simulation.

### Scaffold-vs-spec deltas (cycle 172, 2026-04-19)

§Instructions reconciliation against `programs/capability_registry/src/instructions/`. Pre-edit enumeration covered 8 ixs; scaffold ships 9 (8 spec'd + 1 absent block). Smallest §Instructions delta across the 5 M1-in-scope programs (vs cycle 167 task_market 15-ix delta + cycle 166 dispute_arbitration 3-class drift + cycle 163 treasury_standard 6-ix delta). One pure absent-block reconciliation; no arg-shape drift, no half-fiction, no enumeration gap on the 8 pre-edit blocks.

- **Absent block (1 ix) — `set_tag_personhood(bit_index: u8, min_tier: u8)` at `instructions/set_tag_personhood.rs:27`.** Authority-signed mutator on an existing `CapabilityTag` PDA. **Validation:** `!paused`, `min_tier ≤ PERSONHOOD_TIER_VERIFIED` (constant `2` per `state.rs:38`; tier ladder = NONE=0 / BASIC=1 / VERIFIED=2), `tag.bit_index == bit_index`, `!tag.retired`. **State transition:** writes `tag.min_personhood_tier = min_tier`. **CPI:** none. **Emits:** reuses `TagManifestUpdated { bit_index }` rather than a personhood-specific event — semantic-drift callout for any reviewer cross-reading the §Events table (the event name reads as "manifest updated" but the call site only mutates the personhood tier; manifest URI itself is unchanged). Landed `b435db7` (2026-04-16, "programs: personhood gate (#4) + token-2022 hook allowlist (#5)") per `specs/pre-audit-04-personhood-gate.md`. Caller surface: `agent_registry::register_agent` reads `tag.min_personhood_tier` against the agent's `personhood_attestation` tier (per spec 03 personhood-gate addition); reads only, no CPI back into capability_registry.
- **State-side drift (not patched here) — `CapabilityTag.min_personhood_tier: u8`** absent from spec §State lines 32–37 (which lists `bit_index, slug, manifest_uri, retired, added_by, added_at`). Scaffold field at `state.rs:32`. Default `0` (`PERSONHOOD_TIER_NONE`) on `propose_tag`. Held for a separate §State-sweep cycle to keep this cycle's scope at §Instructions.
- **Event-side semantic drift (not patched here) — `TagManifestUpdated` reused for personhood-tier mutation.** Event payload `{ bit_index }` carries no discriminant between manifest-URI-update vs personhood-tier-update; off-chain consumers must read the post-emit `CapabilityTag` account state to disambiguate. §Events sweep (cycle 161) explicitly accepted "all 7 struct-declared events emit on at least one call site" — that statement remains true post-`set_tag_personhood`, but the 1:1 event-name ↔ semantic-meaning mapping has loosened. Held for a separate §Events-refresh cycle.
- **Guard-admin parity:** capability_registry has **no guard module** by design (no CPI-out surface beyond the `validate_mask` readonly view, per pre-edit §Events paragraph line 88). Unlike treasury_standard / dispute_arbitration / task_market reconciliations (cycles 163 / 166 / 167) which surfaced 4-ix guard-admin absent blocks, no guard-admin block exists for this program — the 5-program guard-vocabulary matrix row for capability_registry is `N/A`, not `live-no-events`.
- **M1 §Instructions arc state post-cycle:** 4-of-5 M1-in-scope programs reconciled (treasury_standard cycle 163, dispute_arbitration cycle 166, task_market cycle 167, capability_registry this cycle). Remaining 2 candidates from cycle 167's queue: (ag-2) `specs/03-program-agent-registry.md` (personhood-gate addition + guard-admin block + retired record_job_outcome rail per F-2026-03), (ag-5) `specs/06-program-proof-verifier.md` (cycle-117 chunked-flow pair `init_vk` + `append_vk_ic` per `b5916a6` + guard-admin block absent + `register_vk` single-tx legacy-path note). Note: agent_registry is M1-in-scope (per ottersec-m1.md §2.2); proof_verifier is M1-in-scope (per ottersec-m1.md §2.5); both required to close the M1 §Instructions sweep arc.

## Events

All 7 struct-declared events in the IDL (`programs/capability_registry/src/events.rs`) emit on at least one call site — no struct-only placeholders. Unlike the 7 sister in-scope programs (agent_registry, task_market, treasury_standard, proof_verifier, fee_collector, nxs_staking, dispute_arbitration), CapabilityRegistry carries no guard module: there is no CPI-out surface beyond the `validate_mask` readonly view, so the `GuardConfig` + `AllowedCallers` reentrancy-guard pattern is not applicable here, and the 5 `GuardEntered` / `ReentrancyRejected` / `GuardInitialized` / `GuardAdminReset` / `AllowedCallersUpdated` events documented in those sister specs are absent from this program's IDL by design.

Emit inventory (7 events, 8 call sites):

- `RegistryInitialized { authority }` — `initialize.rs:32`
- `TagApproved { bit_index, slug, added_by, timestamp }` — `propose_tag.rs:68`
- `TagRetired { bit_index, timestamp }` — `retire_tag.rs:39`
- `TagManifestUpdated { bit_index }` — dual-emit: `update_manifest_uri.rs:41` on manifest-URI overwrite **and** `set_tag_personhood.rs:40` on personhood-tier change. The second call site lives on an ix surface not enumerated in §Instructions above (`set_tag_personhood(bit_index, min_tier)` mutates `CapabilityTag.min_personhood_tier` per `pre-audit-04-personhood-gate.md`). Indexer consumers cannot distinguish a manifest-URI change from a personhood-tier change off the IDL event alone; disambiguation requires reading the tag account state post-emit.
- `AuthorityTransferProposed { pending }` — `authority.rs:26`
- `AuthorityTransferAccepted { new_authority }` — `authority.rs:55`
- `PausedSet { paused }` — `set_paused.rs:23`

Field-carrying shape: `timestamp: i64` on 2 of 7 (`TagApproved`, `TagRetired`); absent from the other 5 (`RegistryInitialized`, `TagManifestUpdated`, `AuthorityTransferProposed`, `AuthorityTransferAccepted`, `PausedSet`) — indexer resolves timestamps for those off the containing tx. No `slot` field anywhere. `bit_index: u8` keys the 3 tag-scoped events (`TagApproved`, `TagRetired`, `TagManifestUpdated`); there is no `agent_did` analog because this program is tag-scoped, not agent-scoped. `authority: Pubkey` on `RegistryInitialized` only — subsequent authority rotation emits `AuthorityTransferProposed { pending }` + `AuthorityTransferAccepted { new_authority }` rather than a post-rotation config snapshot.

## Errors

- `Unauthorized`
- `AlreadyInitialized`
- `BitIndexOutOfRange`
- `TagAlreadyExists`
- `TagNotFound`
- `TagRetired`
- `InvalidSlug`
- `InvalidManifestUri`
- `InvalidCapability` — mask contains unapproved bits
- `Paused`
- `NoPendingAuthority`

## CU budget (M1 default, reviewer may tighten)

| Instruction | Target CUs |
|---|---|
| `initialize` | 15k |
| `propose_tag` | 20k |
| `retire_tag` | 10k |
| `update_manifest_uri` | 10k |
| `transfer_authority` / `accept_authority` | 5k |
| `validate_mask` (view) | 2k |

## Invariants

1. `popcount(approved_mask) + retired_count == tag_count` at all times.
2. No `CapabilityTag.bit_index >= 128`.
3. Once retired, a bit is never re-approved (enforced by `TagAlreadyExists` on the PDA).
4. `authority` is never the zero pubkey post-`initialize`.
5. Agents registered against bit `b` remain queryable even after bit `b` is retired (retirement is forward-only).

## Security checks (grounded in backend §5.1)

- **Account Validation:** every handler verifies `RegistryConfig` PDA derivation via Anchor `seeds = [b"config"], bump = config.bump`. `CapabilityTag` derived via `[b"tag", &[bit_index]]`. Anchor discriminator enforced.
- **Authorization:** all mutating instructions gate on `authority` signer. `initialize` is one-shot (PDA existence check).
- **Re-entrancy:** no CPI out. `validate_mask` is read-only.
- **Integer Safety:** `tag_count` uses `checked_add`. Bitmask set/clear via `checked_shl` against `1u128` with `bit_index` bounded to `< 128` before shift.
- **Upgrade Safety:** program upgrade authority in Squads 4-of-7 multisig from day 1; 7-day timelock per §2.6. In-program `authority` begins as multisig, migrates to GovernanceProgram PDA in M2.
- **Pause:** emergency pause blocks all state-mutating instructions except authority handoff.
- **No Token-2022 surface:** this program does not touch mints.

## M1 initial tag set (32)

Seeded via 32 sequential `propose_tag` calls after `initialize`. Slugs (bit index in parens):

`retrieval_rag(0)`, `retrieval_web(1)`, `code_gen(2)`, `code_review(3)`, `code_exec_sandbox(4)`, `text_summarize(5)`, `text_translate(6)`, `text_classify(7)`, `image_gen(8)`, `image_caption(9)`, `image_ocr(10)`, `audio_transcribe(11)`, `audio_synthesize(12)`, `data_clean(13)`, `data_extract(14)`, `data_label(15)`, `scraping_public(16)`, `moderation_content(17)`, `embedding(18)`, `search_semantic(19)`, `routing(20)`, `pricing(21)`, `negotiation(22)`, `escrow_ops(23)`, `solana_read(24)`, `solana_sign(25)`, `defi_quote(26)`, `defi_execute(27)`, `oracle_read(28)`, `nft_mint(29)`, `governance_vote(30)`, `inference_generic(31)`.

Bits 32..127 reserved for governance expansion.

Seed script lives in the program's `scripts/seed_capabilities.ts`; CI asserts the 32 `TagApproved` events fire on a fresh localnet bring-up.

## Done-checklist

- [ ] Program compiles with Anchor 1.0, passes `cargo clippy -- -D warnings`
- [ ] `RegistryConfig` and `CapabilityTag` accounts round-trip in unit tests
- [ ] `propose_tag` rejects: out-of-range bit, duplicate bit, bad slug chars, unauthorized signer, paused state
- [ ] `retire_tag` clears the bit and rejects subsequent `propose_tag` on the same index
- [ ] Two-step authority transfer covered: propose, unauthorized accept rejected, correct accept succeeds
- [ ] `validate_mask` returns `InvalidCapability` for masks containing unapproved or retired bits
- [ ] Integration test: seed-32 script produces `approved_mask == (1u128 << 32) - 1`
- [ ] Anchor test: CU measurement per instruction logged; within budget above
- [ ] IDL committed under `target/idl/capability_registry.json`
- [ ] `reports/02-capability-registry-anchor.md` covering storage cost per tag and governance handoff plan
- [ ] Audit checklist items from §5.1 addressed with inline code references
