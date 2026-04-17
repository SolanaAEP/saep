use anchor_lang::prelude::*;

use crate::errors::GovernanceError;
use crate::events::ProgramRegistered;
use crate::state::*;

#[derive(Accounts)]
pub struct RegisterProgram<'info> {
    #[account(
        seeds = [SEED_GOV_CONFIG],
        bump = config.bump,
        has_one = authority @ GovernanceError::Unauthorized,
    )]
    pub config: Box<Account<'info, GovernanceConfig>>,

    #[account(
        mut,
        seeds = [SEED_PROGRAM_REGISTRY],
        bump = registry.bump,
    )]
    pub registry: Box<Account<'info, ProgramRegistry>>,

    pub authority: Signer<'info>,
}

pub fn handler(
    ctx: Context<RegisterProgram>,
    label: [u8; 16],
    program_id: Pubkey,
    is_critical: bool,
    param_authority_seed: [u8; 32],
    max_param_payload_bytes: u16,
) -> Result<()> {
    let reg = &mut ctx.accounts.registry;
    require!(
        reg.entries.len() < MAX_REGISTERED_PROGRAMS,
        GovernanceError::RegistryFull
    );
    require!(
        !reg.entries.iter().any(|e| e.program_id == program_id),
        GovernanceError::DuplicateProgram
    );

    reg.entries.push(RegisteredProgram {
        program_id,
        label,
        is_critical,
        param_authority_seed,
        max_param_payload_bytes,
    });

    let now = Clock::get()?.unix_timestamp;
    emit!(ProgramRegistered {
        program_id,
        label,
        is_critical,
        timestamp: now,
    });
    Ok(())
}
