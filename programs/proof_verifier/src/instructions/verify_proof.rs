use anchor_lang::prelude::*;
use solana_instructions_sysvar::{
    load_current_index_checked, load_instruction_at_checked, ID as IX_SYSVAR_ID,
};

use crate::errors::ProofVerifierError;
use crate::events::ReentrancyRejected;
use crate::guard::{
    check_callee_preconditions, load_caller_guard, AllowedCallers, ReentrancyGuard,
    SEED_ALLOWED_CALLERS, SEED_GUARD,
};
use crate::pairing::verify_groth16;
use crate::state::{scalar_in_field, GlobalMode, VerifierConfig, VerifierKey};

#[derive(Accounts)]
pub struct VerifyProof<'info> {
    #[account(seeds = [b"verifier_config"], bump = config.bump)]
    pub config: Account<'info, VerifierConfig>,

    #[account(
        seeds = [b"vk", vk.vk_id.as_ref()],
        bump = vk.bump,
    )]
    pub vk: Account<'info, VerifierKey>,

    #[account(seeds = [b"mode"], bump = mode.bump)]
    pub mode: Account<'info, GlobalMode>,

    #[account(seeds = [SEED_GUARD], bump = self_guard.bump)]
    pub self_guard: Box<Account<'info, ReentrancyGuard>>,

    #[account(seeds = [SEED_ALLOWED_CALLERS], bump = allowed_callers.bump)]
    pub allowed_callers: Box<Account<'info, AllowedCallers>>,

    /// CHECK: caller program's reentrancy guard. Owner is validated at runtime
    /// via `load_caller_guard` against the expected caller program derived from
    /// the instructions sysvar; Anchor's default owner check (=crate::ID) would
    /// reject a legitimately-foreign-owned guard. See F-2026-04.
    pub caller_guard: UncheckedAccount<'info>,

    /// CHECK: Solana instructions sysvar (address check enforced by Anchor).
    #[account(address = IX_SYSVAR_ID)]
    pub instructions: UncheckedAccount<'info>,
}

pub fn handler(
    ctx: Context<VerifyProof>,
    proof_a: [u8; 64],
    proof_b: [u8; 128],
    proof_c: [u8; 64],
    public_inputs: Vec<[u8; 32]>,
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

    verify_groth16(vk, &proof_a, &proof_b, &proof_c, &public_inputs)
}
