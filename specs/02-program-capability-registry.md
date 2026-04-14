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

### `CapabilityTag` PDA — one per tag, immutable after init
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

## Events

- `RegistryInitialized { authority }`
- `TagApproved { bit_index, slug, added_by, timestamp }`
- `TagRetired { bit_index, timestamp }`
- `TagManifestUpdated { bit_index }`
- `AuthorityTransferProposed { pending }`
- `AuthorityTransferAccepted { new_authority }`
- `PausedSet { paused }`

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
