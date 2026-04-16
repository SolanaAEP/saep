use anchor_lang::prelude::*;

use crate::civic::GatewayToken;
use crate::errors::AgentRegistryError;
use crate::events::{
    GatekeeperAllowlistUpdated, PersonhoodAttested, PersonhoodRefreshed,
    PersonhoodRevoked as PersonhoodRevokedEvent,
};
use crate::state::{
    PersonhoodAttestation, PersonhoodTier, ProviderKind, RegistryGlobal, MAX_GATEKEEPER_NETWORKS,
};

pub const SEED_PERSONHOOD: &[u8] = b"personhood";

// F-2026-01: fail-close owner check on the Civic Gateway token account.
// `RegistryGlobal.civic_gateway_program` must be populated via
// `set_civic_gateway_program` before any attestation can succeed; while it's
// still `Pubkey::default()` the ix refuses to decode the token.
pub fn assert_civic_token_owner(
    civic_gateway_token: &AccountInfo,
    civic_gateway_program: &Pubkey,
) -> Result<()> {
    assert_civic_token_owner_pure(civic_gateway_token.owner, civic_gateway_program)
}

pub fn assert_civic_token_owner_pure(
    token_owner: &Pubkey,
    civic_gateway_program: &Pubkey,
) -> Result<()> {
    require!(
        *civic_gateway_program != Pubkey::default(),
        AgentRegistryError::CivicGatewayProgramNotSet
    );
    require_keys_eq!(
        *token_owner,
        *civic_gateway_program,
        AgentRegistryError::CivicGatewayProgramMismatch
    );
    Ok(())
}

pub fn derive_attestation_ref(token: &Pubkey, slot: u64) -> [u8; 32] {
    let mut buf = [0u8; 40];
    buf[..32].copy_from_slice(token.as_ref());
    buf[32..].copy_from_slice(&slot.to_le_bytes());
    solana_keccak_hasher::hashv(&[&buf]).to_bytes()
}

pub fn tier_for_network(global: &RegistryGlobal, network: &Pubkey) -> PersonhoodTier {
    // First slot in the civic list conventionally is the Verified network; any
    // other allowed network is treated as Basic. Governance controls ordering
    // via `set_gatekeeper_allowlist` and can flip networks by replacing the
    // list.
    let len = (global.allowed_civic_networks_len as usize).min(MAX_GATEKEEPER_NETWORKS);
    if len == 0 {
        return PersonhoodTier::None;
    }
    if &global.allowed_civic_networks[0] == network {
        return PersonhoodTier::Verified;
    }
    if global.allowed_civic_networks[..len].iter().any(|k| k == network) {
        return PersonhoodTier::Basic;
    }
    PersonhoodTier::None
}

#[derive(Accounts)]
pub struct AttestPersonhood<'info> {
    #[account(seeds = [b"global"], bump = global.bump)]
    pub global: Box<Account<'info, RegistryGlobal>>,

    #[account(
        init,
        payer = operator,
        space = 8 + PersonhoodAttestation::INIT_SPACE,
        seeds = [SEED_PERSONHOOD, operator.key().as_ref()],
        bump,
    )]
    pub attestation: Box<Account<'info, PersonhoodAttestation>>,

    /// CHECK: data layout validated via `GatewayToken::decode` in handler.
    pub civic_gateway_token: UncheckedAccount<'info>,

    #[account(mut)]
    pub operator: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn attest_personhood_handler(ctx: Context<AttestPersonhood>) -> Result<()> {
    let global = &ctx.accounts.global;
    require!(!global.paused, AgentRegistryError::Paused);

    assert_civic_token_owner(
        &ctx.accounts.civic_gateway_token.to_account_info(),
        &global.civic_gateway_program,
    )?;

    let data = ctx.accounts.civic_gateway_token.data.borrow();
    let token = GatewayToken::decode(&data)?;
    drop(data);

    require_keys_eq!(
        token.owner_wallet,
        ctx.accounts.operator.key(),
        AgentRegistryError::GatewayTokenOwnerMismatch
    );
    require!(
        global.is_allowed_gatekeeper(ProviderKind::Civic, &token.gatekeeper_network),
        AgentRegistryError::GatekeeperNotAllowed
    );
    token.assert_active()?;

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    let expires_at = token.assert_unexpired(now)?;

    let tier = tier_for_network(global, &token.gatekeeper_network);
    require!(
        tier != PersonhoodTier::None,
        AgentRegistryError::GatekeeperNotAllowed
    );

    let attestation_ref =
        derive_attestation_ref(&ctx.accounts.civic_gateway_token.key(), clock.slot);

    let a = &mut ctx.accounts.attestation;
    a.operator = ctx.accounts.operator.key();
    a.provider = ProviderKind::Civic;
    a.tier = tier;
    a.gatekeeper_network = token.gatekeeper_network;
    a.attestation_ref = attestation_ref;
    a.attested_at = now;
    a.expires_at = expires_at;
    a.revoked = false;
    a.bump = ctx.bumps.attestation;

    emit!(PersonhoodAttested {
        operator: a.operator,
        provider: provider_code(a.provider),
        tier: tier_code(a.tier),
        expires_at: a.expires_at,
        timestamp: now,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct RevokePersonhood<'info> {
    #[account(
        seeds = [b"global"],
        bump = global.bump,
        has_one = authority @ AgentRegistryError::Unauthorized,
    )]
    pub global: Box<Account<'info, RegistryGlobal>>,

    #[account(
        mut,
        seeds = [SEED_PERSONHOOD, attestation.operator.as_ref()],
        bump = attestation.bump,
    )]
    pub attestation: Box<Account<'info, PersonhoodAttestation>>,

    pub authority: Signer<'info>,
}

pub fn revoke_personhood_handler(
    ctx: Context<RevokePersonhood>,
    reason_code: u16,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let a = &mut ctx.accounts.attestation;
    a.revoked = true;

    emit!(PersonhoodRevokedEvent {
        operator: a.operator,
        reason_code,
        timestamp: now,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct RefreshPersonhood<'info> {
    #[account(seeds = [b"global"], bump = global.bump)]
    pub global: Box<Account<'info, RegistryGlobal>>,

    #[account(
        mut,
        seeds = [SEED_PERSONHOOD, operator.key().as_ref()],
        bump = attestation.bump,
        constraint = attestation.operator == operator.key()
            @ AgentRegistryError::AttestationOperatorMismatch,
    )]
    pub attestation: Box<Account<'info, PersonhoodAttestation>>,

    /// CHECK: data layout validated via `GatewayToken::decode` in handler.
    pub civic_gateway_token: UncheckedAccount<'info>,

    pub operator: Signer<'info>,
}

pub fn refresh_personhood_handler(ctx: Context<RefreshPersonhood>) -> Result<()> {
    let global = &ctx.accounts.global;
    require!(!global.paused, AgentRegistryError::Paused);

    assert_civic_token_owner(
        &ctx.accounts.civic_gateway_token.to_account_info(),
        &global.civic_gateway_program,
    )?;

    let data = ctx.accounts.civic_gateway_token.data.borrow();
    let token = GatewayToken::decode(&data)?;
    drop(data);

    require_keys_eq!(
        token.owner_wallet,
        ctx.accounts.operator.key(),
        AgentRegistryError::GatewayTokenOwnerMismatch
    );
    require!(
        global.is_allowed_gatekeeper(ProviderKind::Civic, &token.gatekeeper_network),
        AgentRegistryError::GatekeeperNotAllowed
    );
    token.assert_active()?;

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    let new_expires = token.assert_unexpired(now)?;

    let tier = tier_for_network(global, &token.gatekeeper_network);
    require!(
        tier != PersonhoodTier::None,
        AgentRegistryError::GatekeeperNotAllowed
    );

    let attestation_ref =
        derive_attestation_ref(&ctx.accounts.civic_gateway_token.key(), clock.slot);

    let a = &mut ctx.accounts.attestation;
    a.provider = ProviderKind::Civic;
    a.tier = tier;
    a.gatekeeper_network = token.gatekeeper_network;
    a.attestation_ref = attestation_ref;
    a.attested_at = now;
    a.expires_at = new_expires;
    a.revoked = false;

    emit!(PersonhoodRefreshed {
        operator: a.operator,
        new_expires_at: a.expires_at,
        timestamp: now,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct SetGatekeeperAllowlist<'info> {
    #[account(
        mut,
        seeds = [b"global"],
        bump = global.bump,
        has_one = authority @ AgentRegistryError::Unauthorized,
    )]
    pub global: Box<Account<'info, RegistryGlobal>>,
    pub authority: Signer<'info>,
}

pub fn set_gatekeeper_allowlist_handler(
    ctx: Context<SetGatekeeperAllowlist>,
    civic_networks: Vec<Pubkey>,
    sas_issuers: Vec<Pubkey>,
    basic_min_tier: PersonhoodTier,
    require_for_register: bool,
) -> Result<()> {
    require!(
        civic_networks.len() <= MAX_GATEKEEPER_NETWORKS,
        AgentRegistryError::GatekeeperListFull
    );
    require!(
        sas_issuers.len() <= MAX_GATEKEEPER_NETWORKS,
        AgentRegistryError::GatekeeperListFull
    );

    let g = &mut ctx.accounts.global;
    g.allowed_civic_networks = [Pubkey::default(); MAX_GATEKEEPER_NETWORKS];
    for (i, k) in civic_networks.iter().enumerate() {
        g.allowed_civic_networks[i] = *k;
    }
    g.allowed_civic_networks_len = civic_networks.len() as u8;

    g.allowed_sas_issuers = [Pubkey::default(); MAX_GATEKEEPER_NETWORKS];
    for (i, k) in sas_issuers.iter().enumerate() {
        g.allowed_sas_issuers[i] = *k;
    }
    g.allowed_sas_issuers_len = sas_issuers.len() as u8;

    g.personhood_basic_min_tier = basic_min_tier;
    g.require_personhood_for_register = require_for_register;

    emit!(GatekeeperAllowlistUpdated {
        civic_len: g.allowed_civic_networks_len,
        sas_len: g.allowed_sas_issuers_len,
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

pub fn verify_attestation(
    attestation: &PersonhoodAttestation,
    expected_operator: &Pubkey,
    required_tier: PersonhoodTier,
    now: i64,
) -> Result<()> {
    if required_tier == PersonhoodTier::None {
        return Ok(());
    }
    require_keys_eq!(
        attestation.operator,
        *expected_operator,
        AgentRegistryError::AttestationOperatorMismatch
    );
    require!(
        !attestation.revoked,
        AgentRegistryError::PersonhoodRevoked
    );
    if attestation.expires_at != 0 {
        require!(
            now <= attestation.expires_at,
            AgentRegistryError::PersonhoodExpired
        );
    }
    require!(
        attestation.meets_tier(required_tier),
        AgentRegistryError::PersonhoodRequired
    );
    Ok(())
}

fn provider_code(p: ProviderKind) -> u8 {
    match p {
        ProviderKind::Civic => 0,
        ProviderKind::SAS => 1,
    }
}

fn tier_code(t: PersonhoodTier) -> u8 {
    match t {
        PersonhoodTier::None => 0,
        PersonhoodTier::Basic => 1,
        PersonhoodTier::Verified => 2,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::civic::{encode_test_token, CIVIC_STATE_ACTIVE, CIVIC_STATE_REVOKED};

    fn mk_global(networks: Vec<Pubkey>) -> RegistryGlobal {
        let mut g = RegistryGlobal {
            authority: Pubkey::default(),
            pending_authority: None,
            capability_registry: Pubkey::default(),
            task_market: Pubkey::default(),
            dispute_arbitration: Pubkey::default(),
            slashing_treasury: Pubkey::default(),
            stake_mint: Pubkey::default(),
            proof_verifier: Pubkey::default(),
            min_stake: 0,
            max_slash_bps: 0,
            slash_timelock_secs: 1,
            paused: false,
            allowed_civic_networks: [Pubkey::default(); MAX_GATEKEEPER_NETWORKS],
            allowed_civic_networks_len: 0,
            allowed_sas_issuers: [Pubkey::default(); MAX_GATEKEEPER_NETWORKS],
            allowed_sas_issuers_len: 0,
            personhood_basic_min_tier: PersonhoodTier::Basic,
            require_personhood_for_register: false,
            civic_gateway_program: Pubkey::default(),
            bump: 0,
        };
        for (i, k) in networks.iter().enumerate() {
            g.allowed_civic_networks[i] = *k;
        }
        g.allowed_civic_networks_len = networks.len() as u8;
        g
    }

    fn mk_attestation(op: Pubkey, tier: PersonhoodTier, expires_at: i64) -> PersonhoodAttestation {
        PersonhoodAttestation {
            operator: op,
            provider: ProviderKind::Civic,
            tier,
            gatekeeper_network: Pubkey::default(),
            attestation_ref: [0u8; 32],
            attested_at: 0,
            expires_at,
            revoked: false,
            bump: 0,
        }
    }

    #[test]
    fn personhood_verify_happy_path() {
        let op = Pubkey::new_unique();
        let a = mk_attestation(op, PersonhoodTier::Basic, 1_000);
        verify_attestation(&a, &op, PersonhoodTier::Basic, 500).unwrap();
    }

    #[test]
    fn personhood_verify_expired_rejected() {
        let op = Pubkey::new_unique();
        let a = mk_attestation(op, PersonhoodTier::Basic, 1_000);
        assert!(verify_attestation(&a, &op, PersonhoodTier::Basic, 2_000).is_err());
    }

    #[test]
    fn personhood_verify_revoked_rejected() {
        let op = Pubkey::new_unique();
        let mut a = mk_attestation(op, PersonhoodTier::Basic, 1_000);
        a.revoked = true;
        assert!(verify_attestation(&a, &op, PersonhoodTier::Basic, 500).is_err());
    }

    #[test]
    fn personhood_verify_wrong_operator_rejected() {
        let op = Pubkey::new_unique();
        let other = Pubkey::new_unique();
        let a = mk_attestation(op, PersonhoodTier::Basic, 1_000);
        assert!(verify_attestation(&a, &other, PersonhoodTier::Basic, 500).is_err());
    }

    #[test]
    fn personhood_verify_tier_mismatch_rejected() {
        let op = Pubkey::new_unique();
        let a = mk_attestation(op, PersonhoodTier::Basic, 1_000);
        assert!(verify_attestation(&a, &op, PersonhoodTier::Verified, 500).is_err());
    }

    #[test]
    fn personhood_verify_none_required_is_noop() {
        let op = Pubkey::new_unique();
        let other = Pubkey::new_unique();
        let mut a = mk_attestation(op, PersonhoodTier::None, 0);
        a.revoked = true;
        verify_attestation(&a, &other, PersonhoodTier::None, 0).unwrap();
    }

    #[test]
    fn personhood_verify_non_expiring_accepted() {
        let op = Pubkey::new_unique();
        let a = mk_attestation(op, PersonhoodTier::Verified, 0);
        verify_attestation(&a, &op, PersonhoodTier::Verified, i64::MAX).unwrap();
    }

    #[test]
    fn tier_for_network_resolves_verified_slot() {
        let verified = Pubkey::new_unique();
        let basic = Pubkey::new_unique();
        let g = mk_global(vec![verified, basic]);
        assert_eq!(tier_for_network(&g, &verified), PersonhoodTier::Verified);
        assert_eq!(tier_for_network(&g, &basic), PersonhoodTier::Basic);
        assert_eq!(tier_for_network(&g, &Pubkey::new_unique()), PersonhoodTier::None);
    }

    #[test]
    fn unknown_gatekeeper_not_allowed() {
        let net = Pubkey::new_unique();
        let g = mk_global(vec![net]);
        let intruder = Pubkey::new_unique();
        assert!(!g.is_allowed_gatekeeper(ProviderKind::Civic, &intruder));
        assert!(g.is_allowed_gatekeeper(ProviderKind::Civic, &net));
    }

    #[test]
    fn attestation_ref_is_deterministic_per_token_slot() {
        let tok = Pubkey::new_unique();
        let a = derive_attestation_ref(&tok, 42);
        let b = derive_attestation_ref(&tok, 42);
        let c = derive_attestation_ref(&tok, 43);
        assert_eq!(a, b);
        assert_ne!(a, c);
    }

    #[test]
    fn decoded_token_roundtrip_matches_state_and_owner() {
        let owner = Pubkey::new_unique();
        let net = Pubkey::new_unique();
        let gk = Pubkey::new_unique();
        let data = encode_test_token(&owner, &net, &gk, CIVIC_STATE_ACTIVE, Some(9_999));
        let tok = GatewayToken::decode(&data).unwrap();
        assert_eq!(tok.owner_wallet, owner);
        assert_eq!(tok.gatekeeper_network, net);
        assert_eq!(tok.assert_unexpired(0).unwrap(), 9_999);

        let revoked = encode_test_token(&owner, &net, &gk, CIVIC_STATE_REVOKED, None);
        assert!(GatewayToken::decode(&revoked).unwrap().assert_active().is_err());
    }

    #[test]
    fn personhood_pda_seeds_deterministic() {
        let program_id = Pubkey::new_unique();
        let op = Pubkey::new_unique();
        let (a, _) = Pubkey::find_program_address(&[SEED_PERSONHOOD, op.as_ref()], &program_id);
        let (b, _) = Pubkey::find_program_address(&[SEED_PERSONHOOD, op.as_ref()], &program_id);
        assert_eq!(a, b);
    }

    #[test]
    fn personhood_pda_per_operator() {
        let program_id = Pubkey::new_unique();
        let op1 = Pubkey::new_unique();
        let op2 = Pubkey::new_unique();
        let (a, _) = Pubkey::find_program_address(&[SEED_PERSONHOOD, op1.as_ref()], &program_id);
        let (b, _) = Pubkey::find_program_address(&[SEED_PERSONHOOD, op2.as_ref()], &program_id);
        assert_ne!(a, b);
    }

    #[test]
    fn civic_token_owner_fails_closed_when_program_unset() {
        let owner = Pubkey::new_unique();
        let res = assert_civic_token_owner_pure(&owner, &Pubkey::default());
        let err = res.unwrap_err();
        assert!(
            format!("{:?}", err).contains("CivicGatewayProgramNotSet"),
            "expected CivicGatewayProgramNotSet, got {:?}",
            err
        );
    }

    #[test]
    fn civic_token_owner_rejects_foreign_owner() {
        let civic = Pubkey::new_unique();
        let forged = Pubkey::new_unique(); // e.g. System Program or any unrelated owner
        let res = assert_civic_token_owner_pure(&forged, &civic);
        let err = res.unwrap_err();
        assert!(
            format!("{:?}", err).contains("CivicGatewayProgramMismatch"),
            "expected CivicGatewayProgramMismatch, got {:?}",
            err
        );
    }

    #[test]
    fn civic_token_owner_accepts_matching_program() {
        let civic = Pubkey::new_unique();
        assert_civic_token_owner_pure(&civic, &civic).unwrap();
    }

    #[test]
    fn civic_token_owner_rejects_system_program_forgery() {
        // Attack sketch from F-2026-01: a System-owned account with a crafted
        // 103-byte payload. The owner check must reject it regardless of payload.
        let civic = Pubkey::new_unique();
        let system_program = anchor_lang::system_program::ID;
        assert!(assert_civic_token_owner_pure(&system_program, &civic).is_err());
    }
}
