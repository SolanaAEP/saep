# program-template-registry

Source-of-truth spec for `programs/template_registry/`.
Parent backlog: `backlog/P1_agent_template_registry.md`. Sits above `agent_registry` — templates mint *reusable agent configurations* consumers fork or rent. Royalties flow on every downstream settlement via CPI from `treasury_standard`.

## Why a separate program

- `agent_registry` is per-agent state (operator, stake, reputation). Templates are per-*design* state (authorship, royalty curve, fork lineage). Mixing bloats `AgentAccount` and complicates audit scope.
- Audit scope matters: templates carry value (royalties streams) but are read-only from settlement's perspective — simpler invariants, smaller audit surface if isolated.
- Deployment independence: template_registry can ship in M2 without re-auditing agent_registry.

## Accounts

```rust
pub const MAX_DESCRIPTOR_LEN: usize = 256;
pub const MAX_ROYALTY_BPS: u16 = 2_000;    // 20% cap
pub const MAX_RENT_DURATION_SECS: i64 = 30 * 24 * 3_600;  // 30d cap

#[account]
#[derive(InitSpace)]
pub struct TemplateRegistryGlobal {
    pub authority: Pubkey,
    pub pending_authority: Option<Pubkey>,
    pub agent_registry: Pubkey,
    pub treasury_standard: Pubkey,
    pub fee_collector: Pubkey,
    pub royalty_cap_bps: u16,            // <= MAX_ROYALTY_BPS
    pub platform_fee_bps: u16,
    pub rent_escrow_mint: Pubkey,        // canonical rental token (usdc by default)
    pub paused: bool,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum TemplateStatus { Draft, Published, Deprecated, Retired }

#[account]
#[derive(InitSpace)]
pub struct AgentTemplate {
    pub template_id: [u8; 32],           // keccak(author || nonce || config_hash)
    pub author: Pubkey,                  // operator
    pub config_hash: [u8; 32],           // hash of off-chain manifest (arweave/ipfs)
    pub config_uri: [u8; 128],           // resolver pointer
    pub capability_mask: u128,           // bits declared by template
    pub royalty_bps: u16,                // split to author on downstream revenue
    pub parent_template: Option<Pubkey>, // None for originals, Some for forks
    pub lineage_depth: u8,               // 0 original, +1 per fork; capped at 8
    pub fork_count: u32,
    pub rent_count: u32,
    pub total_revenue: u64,              // aggregated via CPI, rolled-up display field
    pub rent_price_per_sec: u64,         // if 0, rental disabled
    pub min_rent_duration: i64,
    pub max_rent_duration: i64,
    pub status: TemplateStatus,
    pub created_at: i64,
    pub updated_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct TemplateFork {
    pub child_agent_did: [u8; 32],       // agent_registry::AgentAccount.did
    pub parent_template: Pubkey,
    pub forker: Pubkey,
    pub royalty_bps_snapshot: u16,       // frozen at fork time; later template edits don't retro-apply
    pub forked_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct TemplateRental {
    pub template: Pubkey,
    pub renter: Pubkey,                  // consumer wallet, not operator
    pub start_time: i64,
    pub end_time: i64,
    pub prepaid_amount: u64,             // escrowed; drips per-second
    pub drip_rate_per_sec: u64,
    pub claimed_author: u64,
    pub claimed_platform: u64,
    pub status: RentalStatus,
    pub bump: u8,
    pub escrow_bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum RentalStatus { Active, Closed, Cancelled }
```

PDAs:
- `TemplateRegistryGlobal`: `[b"tpl_global"]`
- `AgentTemplate`: `[b"template", template_id]`
- `TemplateFork`: `[b"fork", child_agent_did]` (one per agent; every forked agent has a reverse pointer)
- `TemplateRental`: `[b"rental", template, renter, rental_nonce]`
- Rental escrow (token account): `[b"rental_escrow", rental.key()]`

## Instructions

| ix | signer | args | effect |
|---|---|---|---|
| `init_global` | authority | royalty_cap_bps, platform_fee_bps, rent_escrow_mint | init TemplateRegistryGlobal |
| `set_global_params` | authority | — | pause, update fee/royalty caps (caps only lower, never raise without 2-step) |
| `mint_template` | author (operator) | config_hash, config_uri, capability_mask, royalty_bps, rent_price_per_sec, min/max_rent_duration | publish, assign template_id |
| `update_template` | author | new config_hash, new_uri | Status == Published/Draft only; bumps `updated_at`; existing forks unaffected (snapshot) |
| `retire_template` | author or authority | — | status → Retired; no new forks/rentals; existing continue |
| `fork_template` | forker (operator) | child_agent_did, fork_nonce | CPI into agent_registry::register_agent with parent_template → TemplateFork PDA; parent.fork_count += 1 |
| `open_rental` | renter | duration_secs, rental_nonce | transfer prepaid_amount to escrow, create TemplateRental; drip_rate = rent_price_per_sec; bounded by min/max |
| `claim_rental_revenue` | anyone (permissionless crank) | — | compute accrued, split author royalty + platform fee, transfer to author_ata + fee_collector; update claimed_* |
| `close_rental` | renter or permissionless after end_time | — | drain remaining escrow back to renter if before end, or finalize + claim all if after |
| `settle_royalty_cpi` | signer = treasury_standard PDA | template, gross_amount | **CPI-only from treasury_standard on agent settlement**: deducts royalty_bps, transfers to author_ata, bumps total_revenue |

## CPI graph additions (ref pre-audit 07)

Add edges:
```
treasury_standard → template_registry (settle_royalty_cpi only)
template_registry → agent_registry    (fork_template path: register_agent with parent pointer)
template_registry → fee_collector     (claim_rental_revenue: platform fee)
template_registry → token_program     (escrow transfers)
```

No back-edges. `template_registry` never CPIs into `task_market` or `treasury_standard`.

## Invariants

1. `royalty_bps <= royalty_cap_bps`. Cap mutation is 2-step with 48h timelock.
2. `rent_price_per_sec == 0` → `open_rental` returns `RentalDisabled`.
3. `lineage_depth <= 8` — blocks pathological fork trees (rent-grief + royalty cascade).
4. Forks inherit `capability_mask` AND the set of advertised capabilities — child cannot declare bits the parent lacked.
5. `TemplateFork.royalty_bps_snapshot` immutable post-creation — template edits don't retro-apply to forked agents.
6. `settle_royalty_cpi` callable only from `TreasuryGlobal.treasury_authority` PDA (whitelist via PDA address, not program id alone).
7. Rental drip math: `drip_rate_per_sec * duration == prepaid_amount ± rounding_lamports` (tolerance 1).
8. `claim_rental_revenue` before `start_time` → noop. After `end_time` → caps at `prepaid_amount - already_claimed`.
9. Platform fee + author royalty on rental claim ≤ 100% (obvious, but asserted).

## Royalty flow on downstream settlement

```
task_market::release
  └─ CPI treasury_standard::transfer_to_agent(gross)
       └─ if agent has TemplateFork:
            └─ CPI template_registry::settle_royalty_cpi(parent_template, gross)
                 └─ royalty = gross * parent.royalty_bps / 10_000
                 └─ net = gross - royalty
                 └─ token transfer royalty → author_ata
                 └─ parent.total_revenue += royalty
            └─ token transfer net → agent_vault
       └─ else: token transfer gross → agent_vault
```

One royalty-receiver per agent. Multi-hop royalties (parent of parent) explicitly not M1 scope — cap at immediate parent via `lineage_depth` check + single CPI. Multi-hop revisit in M2 after audit.

## Fee math

Rental settlement (per `claim_rental_revenue`):
```
accrued            = (min(now, end_time) - start_time) * drip_rate_per_sec - (claimed_author + claimed_platform)
platform_fee       = accrued * platform_fee_bps / 10_000
author_royalty     = accrued * royalty_bps     / 10_000
renter_retained    = accrued - platform_fee - author_royalty   # locked in escrow until close
```

`renter_retained` covers the agent's actual compute cost; released to agent operator on `close_rental`. This is the rental analog of streaming payments.

## Events

- `TemplatePublished { template_id, author, config_hash, royalty_bps }`
- `TemplateForked { template_id, child_agent_did, forker, royalty_bps_snapshot }`
- `RentalOpened { template, renter, start, end, prepaid }`
- `RentalRevenueClaimed { rental, platform_fee, author_royalty, renter_retained }`
- `RoyaltySettled { template, gross, royalty, settler }`

## Frontend hooks (packages/sdk-ui additions)

- `useTemplate(templateId: PublicKey)` — fetches + subscribes via yellowstone.
- `useTemplateList({ author?, capability_mask? })` — indexed filter.
- `useForkTemplate()` — mutation returning tx signature.
- `useRentTemplate()` — mutation: handles escrow approval + open_rental atomic.
- `useRentalStatus(rentalPubkey)` — polls accrual, displays time remaining + cost.

All hooks wrap `@saep/sdk/programs::templateRegistryProgram` factory (new output of the codegen script once IDL lands).

## Portal surface (apps/portal)

- `/templates` — catalog, filter by capability + price + reputation of author.
- `/templates/[id]` — detail: config preview, fork tree visualization (truncated to lineage_depth 3), author reputation badge, rent/fork buttons.
- `/templates/[id]/rent` — modal flow: duration picker (within min/max), cost estimate, one-click escrow approve + open_rental.
- `/agents/[did]/parent` — reverse lookup: "forked from template X (lineage_depth=N)" on every agent page.

## Audit scope

Isolated surface. Reviewer checklist:
- Only `settle_royalty_cpi` exposes value outward; verify caller PDA pin.
- Rental drip math — no mismatch with escrow prepaid.
- Fork lineage cap prevents rent-farming attacks (fork-then-rent-cheap to redirect royalties).
- Template edit doesn't retro-apply (snapshot at fork time).

## Verify

```
anchor build -p template_registry
cargo test -p template_registry
anchor test tests/template_registry.ts
pnpm --filter @saep/portal test:e2e -- --grep "rent|fork"
```

## Open questions

- Multi-hop royalty: M2 only, cap at single hop for M1 to bound audit scope.
- Rental pricing in non-USDC mints: lean no for M1 (single canonical mint); govern-flippable to multi-mint post-audit.
- Template ownership transfer: out of scope for M1; design doc in M2.
