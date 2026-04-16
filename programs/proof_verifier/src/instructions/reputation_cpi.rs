use agent_registry::cpi::accounts::UpdateReputation as UpdateReputationAccounts;
use agent_registry::cpi::update_reputation;
use agent_registry::program::AgentRegistry;
use agent_registry::state::ReputationSample;
use anchor_lang::prelude::*;
use solana_instructions_sysvar::{
    load_current_index_checked, load_instruction_at_checked, ID as IX_SYSVAR_ID,
};

use crate::errors::ProofVerifierError;
use crate::events::ReentrancyRejected;
use crate::guard::{
    check_callee_preconditions, AllowedCallers, ReentrancyGuard, SEED_ALLOWED_CALLERS, SEED_GUARD,
};
use crate::pairing::verify_groth16;
use crate::state::{scalar_in_field, GlobalMode, VerifierConfig, VerifierKey};

pub const REP_AUTHORITY_SEED: &[u8] = b"rep_authority";

#[derive(Accounts)]
pub struct VerifyAndUpdateReputation<'info> {
    #[account(seeds = [b"verifier_config"], bump = config.bump)]
    pub config: Account<'info, VerifierConfig>,

    #[account(
        seeds = [b"vk", vk.vk_id.as_ref()],
        bump = vk.bump,
    )]
    pub vk: Account<'info, VerifierKey>,

    #[account(seeds = [b"mode"], bump = mode.bump)]
    pub mode: Account<'info, GlobalMode>,

    /// CHECK: PDA signer seeded `[b"rep_authority"]` within this program.
    /// Only passed through to agent_registry as the CPI signer; ownership of
    /// the derivation is the security guarantee.
    #[account(
        seeds = [REP_AUTHORITY_SEED],
        bump,
    )]
    pub rep_authority: UncheckedAccount<'info>,

    /// CHECK: validated by agent_registry against global + seeds.
    #[account(mut)]
    pub registry_global: UncheckedAccount<'info>,

    /// CHECK: validated by agent_registry against agent PDA + did match.
    pub registry_agent: UncheckedAccount<'info>,

    /// CHECK: validated by agent_registry as the CategoryReputation PDA.
    #[account(mut)]
    pub category_reputation: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(seeds = [SEED_GUARD], bump = self_guard.bump)]
    pub self_guard: Box<Account<'info, ReentrancyGuard>>,

    #[account(seeds = [SEED_ALLOWED_CALLERS], bump = allowed_callers.bump)]
    pub allowed_callers: Box<Account<'info, AllowedCallers>>,

    pub caller_guard: Box<Account<'info, ReentrancyGuard>>,

    /// CHECK: Solana instructions sysvar (address check enforced by Anchor).
    #[account(address = IX_SYSVAR_ID)]
    pub instructions: UncheckedAccount<'info>,

    /// agent_registry's self_guard PDA, for the downstream update_reputation CPI.
    /// CHECK: passed through to agent_registry which verifies seeds + ownership.
    pub registry_self_guard: UncheckedAccount<'info>,

    /// agent_registry's allowed_callers PDA, for the downstream update_reputation CPI.
    /// CHECK: passed through to agent_registry which verifies seeds + ownership.
    pub registry_allowed_callers: UncheckedAccount<'info>,

    pub agent_registry_program: Program<'info, AgentRegistry>,
    pub system_program: Program<'info, System>,
}

#[allow(clippy::too_many_arguments)]
pub fn verify_and_update_reputation_handler(
    ctx: Context<VerifyAndUpdateReputation>,
    proof_a: [u8; 64],
    proof_b: [u8; 128],
    proof_c: [u8; 64],
    public_inputs: Vec<[u8; 32]>,
    agent_did: [u8; 32],
    capability_bit: u16,
    sample: ReputationSample,
    task_id: [u8; 32],
) -> Result<()> {
    let ix_ai = &ctx.accounts.instructions.to_account_info();
    let current_index = load_current_index_checked(ix_ai)?;
    let current_ix = load_instruction_at_checked(current_index as usize, ix_ai)?;
    let stack_height = anchor_lang::solana_program::instruction::get_stack_height();
    let caller_program = if stack_height > 1 && current_index > 0 {
        load_instruction_at_checked((current_index - 1) as usize, ix_ai)?.program_id
    } else {
        current_ix.program_id
    };

    let (expected_caller_guard, _) =
        Pubkey::find_program_address(&[SEED_GUARD], &caller_program);
    if ctx.accounts.caller_guard.key() != expected_caller_guard {
        let clock = Clock::get()?;
        emit!(ReentrancyRejected {
            program: crate::ID,
            offending_caller: caller_program,
            slot: clock.slot,
        });
        return err!(ProofVerifierError::UnauthorizedCaller);
    }

    if let Err(e) = check_callee_preconditions(
        &ctx.accounts.self_guard,
        ctx.accounts.caller_guard.active,
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

    let config = &ctx.accounts.config;
    let vk = &ctx.accounts.vk;
    let mode = &ctx.accounts.mode;

    require!(!config.paused, ProofVerifierError::Paused);
    require_keys_eq!(config.active_vk, vk.key(), ProofVerifierError::VkMismatch);
    require!(
        public_inputs.len() == vk.num_public_inputs as usize,
        ProofVerifierError::PublicInputCountMismatch
    );
    if mode.is_mainnet {
        require!(vk.is_production, ProofVerifierError::NotProductionVk);
    }
    for scalar in &public_inputs {
        require!(scalar_in_field(scalar), ProofVerifierError::PublicInputOutOfField);
    }

    verify_groth16(vk, &proof_a, &proof_b, &proof_c, &public_inputs)?;

    let proof_key = vk.vk_id;
    let bump = ctx.bumps.rep_authority;
    let seeds: &[&[u8]] = &[REP_AUTHORITY_SEED, &[bump]];
    let signer_seeds = &[seeds];

    let cpi_accounts = UpdateReputationAccounts {
        global: ctx.accounts.registry_global.to_account_info(),
        agent: ctx.accounts.registry_agent.to_account_info(),
        category: ctx.accounts.category_reputation.to_account_info(),
        proof_verifier_authority: ctx.accounts.rep_authority.to_account_info(),
        payer: ctx.accounts.payer.to_account_info(),
        self_guard: ctx.accounts.registry_self_guard.to_account_info(),
        allowed_callers: ctx.accounts.registry_allowed_callers.to_account_info(),
        caller_guard: ctx.accounts.self_guard.to_account_info(),
        instructions: ctx.accounts.instructions.to_account_info(),
        system_program: ctx.accounts.system_program.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.agent_registry_program.key(),
        cpi_accounts,
        signer_seeds,
    );
    update_reputation(cpi_ctx, agent_did, capability_bit, sample, task_id, proof_key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::solana_program::pubkey::Pubkey as Pk;

    #[test]
    fn rep_authority_seed_constant() {
        assert_eq!(REP_AUTHORITY_SEED, b"rep_authority");
    }

    #[test]
    fn rep_authority_pda_deterministic() {
        let program_id = Pk::new_unique();
        let (a, _) = Pk::find_program_address(&[REP_AUTHORITY_SEED], &program_id);
        let (b, _) = Pk::find_program_address(&[REP_AUTHORITY_SEED], &program_id);
        assert_eq!(a, b);
    }

    #[test]
    fn rep_authority_pda_program_scoped() {
        let p1 = Pk::new_unique();
        let p2 = Pk::new_unique();
        let (a, _) = Pk::find_program_address(&[REP_AUTHORITY_SEED], &p1);
        let (b, _) = Pk::find_program_address(&[REP_AUTHORITY_SEED], &p2);
        assert_ne!(a, b);
    }
}
