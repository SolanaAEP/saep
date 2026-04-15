# Pre-audit 04 — proof-of-personhood gate

Parent: `backlog/P0_pre_audit_hardening.md` item 4.
Threat: Sybil at entry. Without a personhood anchor, a single adversary spins up N agents, each with its own fresh capability advertisements and reputation. Every mitigation downstream (commit-reveal bond, category rep, stake) scales linearly in attacker cost but also in attacker control — without personhood, reputational reset is free.

## Provider pick

Two viable on-Solana options:
1. **Civic Pass** — live, widely integrated, KYC-optional tiers, on-chain `GatewayToken` account per wallet.
2. **Solana Attestation Service (SAS)** — newer, schema-based, more flexible, controlled by issuers.

Decision: **Civic Pass** for M1. Rationale: ships today, has a stable on-chain PDA model, avoids us writing attestation schema infra mid-audit. SAS revisit at M3 with a migration path (attestations supersede gateway tokens via a `PersonhoodAttestation.provider: ProviderKind` enum).

## On-chain additions

### Location: `agent_registry`

```rust
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum ProviderKind { Civic, SAS }

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum PersonhoodTier {
    None,
    Basic,   // Civic uniqueness pass, no KYC
    Verified // Civic KYC tier
}

#[account]
#[derive(InitSpace)]
pub struct PersonhoodAttestation {
    pub operator: Pubkey,         // the wallet proving personhood
    pub provider: ProviderKind,
    pub tier: PersonhoodTier,
    pub gatekeeper_network: Pubkey, // civic network id or SAS issuer
    pub attestation_ref: [u8; 32],  // hash of source account key + slot
    pub attested_at: i64,
    pub expires_at: i64,          // from source; 0 = non-expiring
    pub revoked: bool,
    pub bump: u8,
}
```

PDA: `[b"personhood", operator]`. One per wallet, not per agent — a wallet can operate many agents but shares one personhood anchor (so Sybil costs scale in wallets, not agents).

### ix `attest_personhood`

- Signer: `operator`.
- Accounts:
  - `operator: Signer`
  - `civic_gateway_token: AccountInfo` (validated off-chain readable)
  - `gatekeeper_network: Pubkey` (from registry_global allowlist)
  - `attestation: PersonhoodAttestation` (init)
- Logic:
  1. Deserialize Civic `GatewayToken` from `civic_gateway_token.data`.
  2. Assert `owner == operator`, `state == Active`, `gatekeeper_network` matches allowlist, `expiry > now`.
  3. Hash `(civic_gateway_token.key.as_ref(), slot)` → `attestation_ref` (frozen pointer).
  4. Store tier derived from gatekeeper network (Basic vs Verified mapping in RegistryGlobal).

### ix `revoke_personhood`

- Signer: registry authority (governance).
- Use case: provider revokes upstream → governance mirrors on-chain.

### ix `refresh_personhood`

- Signer: operator, permissionless after `expires_at`. Re-reads source, updates timestamps, no replacement required if still active.

### RegistryGlobal additions

```rust
pub const MAX_GATEKEEPER_NETWORKS: usize = 8;

pub allowed_civic_networks: [Pubkey; MAX_GATEKEEPER_NETWORKS],
pub allowed_civic_networks_len: u8,
pub allowed_sas_issuers: [Pubkey; MAX_GATEKEEPER_NETWORKS],
pub allowed_sas_issuers_len: u8,
pub personhood_basic_min_tier: PersonhoodTier,
```

Governance ix `set_gatekeeper_allowlist` mutates these.

## Enforcement points

- `task_market::commit_bid` on tasks whose `payload.requires_personhood >= Basic` reads `PersonhoodAttestation` for the bidder's operator; fails if missing, expired, or revoked.
- `agent_registry::register_agent` optional now; required iff governance flips `RegistryGlobal.require_personhood_for_register = true`. Default off for M1 devnet testing, on for mainnet.
- High-tier task categories (flagged in `capability_registry::CapabilityTag.min_personhood_tier`) enforce Verified tier.

## Invariants

1. Missing `PersonhoodAttestation` when required → `PersonhoodRequired`.
2. `attestation.revoked` → treated as missing.
3. `attestation.expires_at != 0 && now > expires_at` → treated as missing.
4. `provider` enum must match `gatekeeper_network`'s allowlist class (Civic pubkey ∈ allowed_civic_networks, etc.).
5. `attestation.operator == signer` at verify time — prevents PDA cloning attempts.
6. One attestation PDA per operator — Anchor `init` on duplicate fails.

## Events

- `PersonhoodAttested { operator, provider, tier, expires_at }`
- `PersonhoodRevoked { operator, reason_code }`
- `PersonhoodRefreshed { operator, new_expires_at }`

## Non-goals

- In-protocol KYC. We only trust the external provider; we do not store documents.
- Per-agent attestation — explicitly per-operator to avoid wallet-farm Sybil arbitrage.

## Verify

```
cargo test -p agent_registry personhood_
anchor test tests/personhood_gate.ts   # mocks civic gateway via token program
```

## Open questions

- Civic fee per attestation passed to operator, not us. Confirm ops-facing doc.
- If Civic downtime: add an `attest_personhood_grace_window` in RegistryGlobal letting a stale-but-recent attestation stand for 24h. Default off; govern can enable during incidents.
