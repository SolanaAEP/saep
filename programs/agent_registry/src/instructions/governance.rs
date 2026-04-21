use anchor_lang::prelude::*;
use spl_token_2022::extension::{BaseStateWithExtensions, StateWithExtensions, transfer_hook::TransferHook};
use spl_token_2022::state::Mint as RawMint;

use crate::errors::AgentRegistryError;
use crate::events::GlobalParamsUpdated;
use crate::state::{RegistryGlobal, MAX_SLASH_BPS_CAP};

#[derive(Accounts)]
pub struct GovernanceUpdate<'info> {
    #[account(
        mut,
        seeds = [b"global"],
        bump = global.bump,
        has_one = authority @ AgentRegistryError::Unauthorized,
    )]
    pub global: Account<'info, RegistryGlobal>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct SetStakeMint<'info> {
    #[account(
        mut,
        seeds = [b"global"],
        bump = global.bump,
        has_one = authority @ AgentRegistryError::Unauthorized,
    )]
    pub global: Account<'info, RegistryGlobal>,
    /// CHECK: validated in handler; only read for owner/extension checks.
    pub stake_mint_info: UncheckedAccount<'info>,
    pub authority: Signer<'info>,
}

fn validate_stake_mint(mint_info: &UncheckedAccount<'_>, stake_mint: Pubkey) -> Result<()> {
    require!(mint_info.key() == stake_mint, AgentRegistryError::Unauthorized);
    require!(
        mint_info.owner == &anchor_spl::token::ID || mint_info.owner == &anchor_spl::token_2022::ID,
        AgentRegistryError::InvalidStakeMint
    );
    if mint_info.owner == &anchor_spl::token_2022::ID {
        let data = mint_info
            .try_borrow_data()
            .map_err(|_| error!(AgentRegistryError::InvalidStakeMint))?;
        let parsed = StateWithExtensions::<RawMint>::unpack(&data)
            .map_err(|_| error!(AgentRegistryError::InvalidStakeMint))?;
        require!(
            parsed.get_extension::<TransferHook>().is_err(),
            AgentRegistryError::StakeMintHasTransferHook
        );
    }
    Ok(())
}

pub fn set_min_stake_handler(ctx: Context<GovernanceUpdate>, new_min_stake: u64) -> Result<()> {
    ctx.accounts.global.min_stake = new_min_stake;
    emit!(GlobalParamsUpdated {
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

pub fn set_max_slash_bps_handler(
    ctx: Context<GovernanceUpdate>,
    new_max_slash_bps: u16,
) -> Result<()> {
    require!(
        new_max_slash_bps <= MAX_SLASH_BPS_CAP,
        AgentRegistryError::SlashCapTooHigh
    );
    ctx.accounts.global.max_slash_bps = new_max_slash_bps;
    emit!(GlobalParamsUpdated {
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

pub fn set_slash_timelock_handler(
    ctx: Context<GovernanceUpdate>,
    new_timelock_secs: i64,
) -> Result<()> {
    require!(new_timelock_secs > 0, AgentRegistryError::TimelockNotElapsed);
    ctx.accounts.global.slash_timelock_secs = new_timelock_secs;
    emit!(GlobalParamsUpdated {
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

pub fn set_paused_handler(ctx: Context<GovernanceUpdate>, paused: bool) -> Result<()> {
    ctx.accounts.global.paused = paused;
    emit!(GlobalParamsUpdated {
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

pub fn set_civic_gateway_program_handler(
    ctx: Context<GovernanceUpdate>,
    new_civic_gateway_program: Pubkey,
) -> Result<()> {
    require!(
        new_civic_gateway_program != Pubkey::default(),
        AgentRegistryError::InvalidCivicGateway
    );
    ctx.accounts.global.civic_gateway_program = new_civic_gateway_program;
    emit!(GlobalParamsUpdated {
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

pub fn set_stake_mint_handler(
    ctx: Context<SetStakeMint>,
    new_stake_mint: Pubkey,
) -> Result<()> {
    validate_stake_mint(&ctx.accounts.stake_mint_info, new_stake_mint)?;
    ctx.accounts.global.stake_mint = new_stake_mint;
    emit!(GlobalParamsUpdated {
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}
