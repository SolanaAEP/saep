use anchor_lang::prelude::*;

use crate::errors::FeeCollectorError;
use crate::events::{CollateralForfeited, SlashReceived};
use crate::state::*;

#[derive(Accounts)]
pub struct RecordSlashReceipt<'info> {
    #[account(seeds = [SEED_FEE_CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, FeeCollectorConfig>>,

    #[account(
        mut,
        seeds = [SEED_EPOCH, current_epoch.epoch_id.to_le_bytes().as_ref()],
        bump = current_epoch.bump,
    )]
    pub current_epoch: Box<Account<'info, EpochAccount>>,

    /// caller program identity — must be one of the registered slash sources
    pub caller_program: Signer<'info>,
}

pub fn slash_handler(ctx: Context<RecordSlashReceipt>, amount: u64) -> Result<()> {
    let config = &ctx.accounts.config;
    let caller = ctx.accounts.caller_program.key();
    require!(
        caller == config.nxs_staking
            || caller == config.agent_registry
            || caller == config.dispute_arbitration,
        FeeCollectorError::CallerNotRegisteredSlasher
    );

    let epoch = &mut ctx.accounts.current_epoch;
    require!(
        epoch.status == EpochStatus::Open,
        FeeCollectorError::EpochNotOpen
    );

    epoch.total_collected = epoch
        .total_collected
        .checked_add(amount)
        .ok_or(FeeCollectorError::ArithmeticOverflow)?;

    let now = Clock::get()?.unix_timestamp;
    emit!(SlashReceived {
        epoch_id: epoch.epoch_id,
        slasher_program: caller,
        amount,
        timestamp: now,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct RecordCollateralForfeit<'info> {
    #[account(seeds = [SEED_FEE_CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, FeeCollectorConfig>>,

    #[account(
        mut,
        seeds = [SEED_EPOCH, current_epoch.epoch_id.to_le_bytes().as_ref()],
        bump = current_epoch.bump,
    )]
    pub current_epoch: Box<Account<'info, EpochAccount>>,

    pub caller_program: Signer<'info>,
}

pub fn forfeit_handler(ctx: Context<RecordCollateralForfeit>, amount: u64) -> Result<()> {
    let config = &ctx.accounts.config;
    let caller = ctx.accounts.caller_program.key();
    require!(
        caller == config.governance_program || caller == config.agent_registry,
        FeeCollectorError::CallerNotRegisteredSlasher
    );

    let epoch = &mut ctx.accounts.current_epoch;
    require!(
        epoch.status == EpochStatus::Open,
        FeeCollectorError::EpochNotOpen
    );

    epoch.total_collected = epoch
        .total_collected
        .checked_add(amount)
        .ok_or(FeeCollectorError::ArithmeticOverflow)?;

    let now = Clock::get()?.unix_timestamp;
    emit!(CollateralForfeited {
        epoch_id: epoch.epoch_id,
        source_program: caller,
        amount,
        timestamp: now,
    });
    Ok(())
}
