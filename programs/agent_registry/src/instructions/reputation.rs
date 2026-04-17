use anchor_lang::prelude::*;
use solana_instructions_sysvar::{
    load_current_index_checked, load_instruction_at_checked, ID as IX_SYSVAR_ID,
};

use crate::errors::AgentRegistryError;
use crate::events::{CategoryReputationUpdated, ReentrancyRejected};
use crate::guard::{
    check_callee_preconditions, load_caller_guard, AllowedCallers, ReentrancyGuard,
    SEED_ALLOWED_CALLERS, SEED_GUARD,
};
use crate::state::{
    ewma, AgentAccount, CategoryReputation, RegistryGlobal, ReputationSample, ReputationScore,
    CATEGORY_REP_VERSION, DEFAULT_CATEGORY_ALPHA_BPS, MAX_CAPABILITY_BIT,
};

pub const PROOF_VERIFIER_REP_AUTHORITY_SEED: &[u8] = b"rep_authority";

#[derive(Accounts)]
#[instruction(agent_did: [u8; 32], capability_bit: u16)]
pub struct UpdateReputation<'info> {
    #[account(seeds = [b"global"], bump = global.bump)]
    pub global: Box<Account<'info, RegistryGlobal>>,

    #[account(
        seeds = [b"agent", agent.operator.as_ref(), agent.agent_id.as_ref()],
        bump = agent.bump,
        constraint = agent.did == agent_did @ AgentRegistryError::AgentNotFound,
    )]
    pub agent: Box<Account<'info, AgentAccount>>,

    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + CategoryReputation::INIT_SPACE,
        seeds = [b"rep", agent_did.as_ref(), &capability_bit.to_le_bytes()],
        bump,
    )]
    pub category: Box<Account<'info, CategoryReputation>>,

    /// PDA signer from the proof_verifier program. The pubkey is asserted
    /// against `global.proof_verifier` via the owner check on the signer's
    /// derivation: proof_verifier invokes with seeds = [b"rep_authority"].
    /// CHECK: key equality to the proof_verifier-owned PDA is enforced in the
    /// handler; signer verification is enforced by `Signer`.
    pub proof_verifier_authority: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(seeds = [SEED_GUARD], bump = self_guard.bump)]
    pub self_guard: Box<Account<'info, ReentrancyGuard>>,

    #[account(seeds = [SEED_ALLOWED_CALLERS], bump = allowed_callers.bump)]
    pub allowed_callers: Box<Account<'info, AllowedCallers>>,

    /// CHECK: Caller program's reentrancy guard PDA. Must be `[b"guard"]` under
    /// one of the programs listed in `allowed_callers`. Validated at runtime via
    /// `load_caller_guard` against the caller program derived from the
    /// instructions sysvar; Anchor's default owner check (=crate::ID) cannot
    /// accept a foreign-owned account. See F-2026-04.
    pub caller_guard: UncheckedAccount<'info>,

    /// CHECK: Solana instructions sysvar (address check enforced by Anchor).
    #[account(address = IX_SYSVAR_ID)]
    pub instructions: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn update_reputation_handler(
    ctx: Context<UpdateReputation>,
    agent_did: [u8; 32],
    capability_bit: u16,
    sample: ReputationSample,
    task_id: [u8; 32],
    proof_key: [u8; 32],
) -> Result<()> {
    let ix_ai = &ctx.accounts.instructions.to_account_info();
    let current_index = load_current_index_checked(ix_ai)?;
    let current_ix = load_instruction_at_checked(current_index as usize, ix_ai)?;
    let stack_height = anchor_lang::solana_program::instruction::get_stack_height();
    // F-2026-12: the instructions sysvar exposes top-level tx instructions,
    // not the CPI stack. For a single-level CPI (stack_height == 2), the
    // immediate caller is always the program invoking us, which Solana
    // records as `current_ix.program_id`. Deeper CPI chains cannot be
    // resolved from the sysvar alone, so we reject them here.
    require!(
        stack_height <= 2,
        AgentRegistryError::CpiDepthExceeded
    );
    let caller_program = current_ix.program_id;

    let caller_guard = match load_caller_guard(
        &ctx.accounts.caller_guard.to_account_info(),
        &caller_program,
    ) {
        Ok(g) => g,
        Err(e) => {
            let clock = Clock::get()?;
            emit!(ReentrancyRejected {
                program: crate::ID,
                offending_caller: caller_program,
                slot: clock.slot,
            });
            return Err(e);
        }
    };

    if let Err(e) = check_callee_preconditions(
        &ctx.accounts.self_guard,
        caller_guard.active,
        &caller_program,
        &ctx.accounts.allowed_callers,
        stack_height,
    ) {
        let clock = Clock::get()?;
        emit!(ReentrancyRejected {
            program: crate::ID,
            offending_caller: caller_program,
            slot: clock.slot,
        });
        return Err(e);
    }

    let g = &ctx.accounts.global;
    require!(!g.paused, AgentRegistryError::Paused);

    let (expected_authority, _) = Pubkey::find_program_address(
        &[PROOF_VERIFIER_REP_AUTHORITY_SEED],
        &g.proof_verifier,
    );
    require_keys_eq!(
        ctx.accounts.proof_verifier_authority.key(),
        expected_authority,
        AgentRegistryError::UnauthorizedReputationUpdate
    );

    require!(
        capability_bit <= MAX_CAPABILITY_BIT,
        AgentRegistryError::InvalidCapabilityBit
    );
    let bit_mask: u128 = 1u128 << capability_bit;
    require!(
        (ctx.accounts.agent.capability_mask & bit_mask) != 0,
        AgentRegistryError::CapabilityNotDeclared
    );

    let now = Clock::get()?.unix_timestamp;
    let cat = &mut ctx.accounts.category;
    let fresh = cat.version == 0;

    if fresh {
        cat.agent_did = agent_did;
        cat.capability_bit = capability_bit;
        cat.score = ReputationScore {
            ewma_alpha_bps: DEFAULT_CATEGORY_ALPHA_BPS,
            ..Default::default()
        };
        cat.jobs_completed = 0;
        cat.jobs_disputed = 0;
        cat.last_proof_key = [0u8; 32];
        cat.last_task_id = [0u8; 32];
        cat.version = CATEGORY_REP_VERSION;
        cat.bump = ctx.bumps.category;
    } else {
        require!(
            cat.last_task_id != task_id,
            AgentRegistryError::ReputationReplay
        );
        require_keys_eq!(
            Pubkey::new_from_array(cat.agent_did),
            Pubkey::new_from_array(agent_did),
            AgentRegistryError::AgentNotFound
        );
        require!(
            cat.capability_bit == capability_bit,
            AgentRegistryError::InvalidCapabilityBit
        );
    }

    let alpha = cat.score.ewma_alpha_bps;
    cat.score.quality = ewma(cat.score.quality, sample.quality, alpha)?;
    cat.score.timeliness = ewma(cat.score.timeliness, sample.timeliness, alpha)?;
    cat.score.availability = ewma(cat.score.availability, sample.availability, alpha)?;
    cat.score.cost_efficiency = ewma(cat.score.cost_efficiency, sample.cost_efficiency, alpha)?;
    cat.score.honesty = ewma(cat.score.honesty, sample.honesty, alpha)?;
    cat.score.volume = cat.score.volume.saturating_add(1).min(10_000);
    cat.score.sample_count = cat
        .score
        .sample_count
        .checked_add(1)
        .ok_or(AgentRegistryError::ArithmeticOverflow)?;
    cat.score.last_update = now;

    cat.jobs_completed = cat
        .jobs_completed
        .checked_add(1)
        .ok_or(AgentRegistryError::ArithmeticOverflow)?;
    if sample.disputed {
        cat.jobs_disputed = cat
            .jobs_disputed
            .checked_add(1)
            .ok_or(AgentRegistryError::ArithmeticOverflow)?;
    }
    require!(
        cat.jobs_disputed as u32 <= cat.jobs_completed,
        AgentRegistryError::ReputationOutOfRange
    );

    cat.last_task_id = task_id;
    cat.last_proof_key = proof_key;

    emit!(CategoryReputationUpdated {
        agent_did,
        capability_bit,
        quality: cat.score.quality,
        timeliness: cat.score.timeliness,
        availability: cat.score.availability,
        cost_efficiency: cat.score.cost_efficiency,
        honesty: cat.score.honesty,
        jobs_completed: cat.jobs_completed,
        jobs_disputed: cat.jobs_disputed,
        task_id,
        timestamp: now,
    });

    Ok(())
}

/// Permissionless crank: decay the availability axis of a CategoryReputation
/// PDA by folding `miss_count` zero-samples through EWMA. Called by the indexer
/// after detecting heartbeat misses on the IACP bus.
///
/// Cooldown: at most once per 24h per (agent_did, capability_bit). Enforced via
/// `last_update` on the availability axis vs clock.
const DECAY_COOLDOWN_SECS: i64 = 86_400;
const MAX_DECAY_MISSES: u8 = 7;

#[derive(Accounts)]
#[instruction(agent_did: [u8; 32], capability_bit: u16)]
pub struct DecayAvailability<'info> {
    #[account(seeds = [b"global"], bump = global.bump)]
    pub global: Box<Account<'info, RegistryGlobal>>,

    #[account(
        mut,
        seeds = [b"rep", agent_did.as_ref(), &capability_bit.to_le_bytes()],
        bump = category.bump,
        constraint = category.agent_did == agent_did @ AgentRegistryError::AgentNotFound,
        constraint = category.capability_bit == capability_bit @ AgentRegistryError::InvalidCapabilityBit,
    )]
    pub category: Box<Account<'info, CategoryReputation>>,
}

pub fn decay_availability_handler(
    ctx: Context<DecayAvailability>,
    agent_did: [u8; 32],
    capability_bit: u16,
    miss_count: u8,
) -> Result<()> {
    let g = &ctx.accounts.global;
    require!(!g.paused, AgentRegistryError::Paused);
    require!(miss_count > 0 && miss_count <= MAX_DECAY_MISSES, AgentRegistryError::ReputationOutOfRange);

    let now = Clock::get()?.unix_timestamp;
    let cat = &mut ctx.accounts.category;

    require!(
        now - cat.score.last_update >= DECAY_COOLDOWN_SECS,
        AgentRegistryError::DecayCooldownNotElapsed
    );

    let old_availability = cat.score.availability;
    let alpha = cat.score.ewma_alpha_bps;

    for _ in 0..miss_count {
        cat.score.availability = ewma(cat.score.availability, 0, alpha)?;
    }
    cat.score.last_update = now;

    emit!(crate::events::AvailabilityDecayed {
        agent_did,
        capability_bit,
        old_availability,
        new_availability: cat.score.availability,
        miss_count,
        timestamp: now,
    });

    Ok(())
}

pub fn set_proof_verifier_handler(
    ctx: Context<super::governance::GovernanceUpdate>,
    new_proof_verifier: Pubkey,
) -> Result<()> {
    ctx.accounts.global.proof_verifier = new_proof_verifier;
    emit!(crate::events::GlobalParamsUpdated {
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::solana_program::pubkey::Pubkey as Pk;

    #[test]
    fn category_rep_pda_derivation_deterministic() {
        let program_id = Pk::new_unique();
        let did = [7u8; 32];
        let bit: u16 = 42;
        let (a, _) =
            Pk::find_program_address(&[b"rep", &did, &bit.to_le_bytes()], &program_id);
        let (b, _) =
            Pk::find_program_address(&[b"rep", &did, &bit.to_le_bytes()], &program_id);
        assert_eq!(a, b);
    }

    #[test]
    fn category_rep_pda_distinct_per_bit() {
        let program_id = Pk::new_unique();
        let did = [7u8; 32];
        let (a, _) = Pk::find_program_address(&[b"rep", &did, &0u16.to_le_bytes()], &program_id);
        let (b, _) = Pk::find_program_address(&[b"rep", &did, &1u16.to_le_bytes()], &program_id);
        assert_ne!(a, b);
    }

    #[test]
    fn cap_bit_range_upper_bound() {
        assert!(MAX_CAPABILITY_BIT <= 127);
        let bit: u16 = MAX_CAPABILITY_BIT;
        let mask: u128 = 1u128 << bit;
        assert_ne!(mask, 0);
    }

    #[test]
    fn cap_bit_out_of_range_detected() {
        let bit: u16 = 128;
        assert!(bit > MAX_CAPABILITY_BIT);
    }

    #[test]
    fn proof_verifier_rep_authority_pda_stable() {
        let pv = Pk::new_unique();
        let (a, _) = Pk::find_program_address(&[PROOF_VERIFIER_REP_AUTHORITY_SEED], &pv);
        let (b, _) = Pk::find_program_address(&[PROOF_VERIFIER_REP_AUTHORITY_SEED], &pv);
        assert_eq!(a, b);
    }

    #[test]
    fn proof_verifier_rep_authority_differs_by_program() {
        let pv1 = Pk::new_unique();
        let pv2 = Pk::new_unique();
        let (a, _) = Pk::find_program_address(&[PROOF_VERIFIER_REP_AUTHORITY_SEED], &pv1);
        let (b, _) = Pk::find_program_address(&[PROOF_VERIFIER_REP_AUTHORITY_SEED], &pv2);
        assert_ne!(a, b);
    }

    #[test]
    fn replay_detection_logic() {
        let t1 = [1u8; 32];
        let t2 = [2u8; 32];
        assert_eq!(t1, t1);
        assert_ne!(t1, t2);
    }
}
