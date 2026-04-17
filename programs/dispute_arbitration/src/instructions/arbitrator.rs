use anchor_lang::prelude::*;

use crate::errors::DisputeArbitrationError;
use crate::events::{ArbitratorRegistered, PoolSnapshotted};
use crate::state::*;

#[derive(Accounts)]
pub struct RegisterArbitrator<'info> {
    #[account(seeds = [SEED_DISPUTE_CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, DisputeConfig>>,

    #[account(
        init,
        payer = operator,
        space = 8 + ArbitratorAccount::INIT_SPACE,
        seeds = [SEED_ARBITRATOR, operator.key().as_ref()],
        bump,
    )]
    pub arbitrator: Box<Account<'info, ArbitratorAccount>>,

    /// CHECK: owner validated against config.nxs_staking.
    /// M2 structural: effective_stake/lock_end passed as args until NXSStaking CPI reads land.
    #[account(owner = config.nxs_staking @ DisputeArbitrationError::StakeInsufficient)]
    pub stake_account: AccountInfo<'info>,

    #[account(mut)]
    pub operator: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn register_handler(
    ctx: Context<RegisterArbitrator>,
    effective_stake: u64,
    lock_end: i64,
) -> Result<()> {
    let config = &ctx.accounts.config;
    require!(!config.paused, DisputeArbitrationError::Paused);
    require!(
        effective_stake >= config.min_stake,
        DisputeArbitrationError::StakeInsufficient
    );
    require!(
        lock_end >= Clock::get()?.unix_timestamp + config.min_lock_secs,
        DisputeArbitrationError::StakeLockTooShort
    );

    let now = Clock::get()?.unix_timestamp;
    let a = &mut ctx.accounts.arbitrator;
    a.operator = ctx.accounts.operator.key();
    a.stake_account = ctx.accounts.stake_account.key();
    a.effective_stake = effective_stake;
    a.effective_lock_end = lock_end;
    a.status = ArbitratorStatus::Active;
    a.bad_faith_strikes = 0;
    a.cases_participated = 0;
    a.withdraw_unlock_time = 0;
    a.registered_at = now;
    a.bump = ctx.bumps.arbitrator;

    emit!(ArbitratorRegistered {
        operator: ctx.accounts.operator.key(),
        effective_stake,
        timestamp: now,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct RefreshStake<'info> {
    #[account(seeds = [SEED_DISPUTE_CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, DisputeConfig>>,

    #[account(
        mut,
        seeds = [SEED_ARBITRATOR, operator.key().as_ref()],
        bump = arbitrator.bump,
        has_one = operator @ DisputeArbitrationError::Unauthorized,
    )]
    pub arbitrator: Box<Account<'info, ArbitratorAccount>>,

    /// CHECK: owner validated against config.nxs_staking.
    /// M2 structural: values passed as args until NXSStaking CPI reads land.
    #[account(owner = config.nxs_staking @ DisputeArbitrationError::StakeInsufficient)]
    pub stake_account: AccountInfo<'info>,

    pub operator: Signer<'info>,
}

pub fn refresh_stake_handler(
    ctx: Context<RefreshStake>,
    new_stake: u64,
    new_lock_end: i64,
) -> Result<()> {
    // M2 structural: caller-supplied until NXSStaking CPI reads are wired.
    let a = &mut ctx.accounts.arbitrator;
    a.effective_stake = new_stake;
    a.effective_lock_end = new_lock_end;

    if new_stake < ctx.accounts.config.min_stake {
        a.status = ArbitratorStatus::Paused;
    }
    Ok(())
}

#[derive(Accounts)]
pub struct SnapshotPool<'info> {
    #[account(seeds = [SEED_DISPUTE_CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, DisputeConfig>>,

    #[account(
        init_if_needed,
        payer = cranker,
        space = 8 + DisputePool::INIT_SPACE,
        seeds = [SEED_DISPUTE_POOL],
        bump,
    )]
    pub pool: Box<Account<'info, DisputePool>>,

    #[account(mut)]
    pub cranker: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn snapshot_pool_handler(
    ctx: Context<SnapshotPool>,
    arbitrators: Vec<Pubkey>,
    stakes: Vec<u64>,
) -> Result<()> {
    require!(
        arbitrators.len() == stakes.len(),
        DisputeArbitrationError::PoolMissing
    );
    require!(
        arbitrators.len() <= MAX_POOL_SIZE,
        DisputeArbitrationError::PoolFull
    );

    let mut cumulative = Vec::with_capacity(stakes.len());
    let mut running: u64 = 0;
    let mut total_u128: u128 = 0;
    for &s in &stakes {
        running = running
            .checked_add(s)
            .ok_or(DisputeArbitrationError::ArithmeticOverflow)?;
        cumulative.push(running);
        total_u128 = total_u128
            .checked_add(s as u128)
            .ok_or(DisputeArbitrationError::ArithmeticOverflow)?;
    }

    let now = Clock::get()?.unix_timestamp;
    let p = &mut ctx.accounts.pool;
    p.snapshot_epoch = p.snapshot_epoch.wrapping_add(1);
    p.snapshot_time = now;
    p.total_staked = total_u128;
    p.arbitrator_count = arbitrators.len() as u16;
    p.arbitrators = arbitrators;
    p.cumulative_stakes = cumulative;
    p.bump = ctx.bumps.pool;

    emit!(PoolSnapshotted {
        epoch: p.snapshot_epoch,
        arbitrator_count: p.arbitrator_count,
        total_staked: p.total_staked,
        timestamp: now,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct BeginWithdraw<'info> {
    #[account(seeds = [SEED_DISPUTE_CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, DisputeConfig>>,

    #[account(
        mut,
        seeds = [SEED_ARBITRATOR, operator.key().as_ref()],
        bump = arbitrator.bump,
        has_one = operator @ DisputeArbitrationError::Unauthorized,
    )]
    pub arbitrator: Box<Account<'info, ArbitratorAccount>>,

    pub operator: Signer<'info>,
}

pub fn begin_withdraw_handler(ctx: Context<BeginWithdraw>) -> Result<()> {
    let a = &mut ctx.accounts.arbitrator;
    require!(
        a.status == ArbitratorStatus::Active || a.status == ArbitratorStatus::Paused,
        DisputeArbitrationError::ArbitratorNotActive
    );

    let now = Clock::get()?.unix_timestamp;
    a.status = ArbitratorStatus::Withdrawing;
    a.withdraw_unlock_time = now + ctx.accounts.config.round2_window_secs;
    Ok(())
}

#[derive(Accounts)]
pub struct CompleteWithdraw<'info> {
    #[account(
        mut,
        seeds = [SEED_ARBITRATOR, operator.key().as_ref()],
        bump = arbitrator.bump,
        has_one = operator @ DisputeArbitrationError::Unauthorized,
        close = operator,
    )]
    pub arbitrator: Box<Account<'info, ArbitratorAccount>>,

    #[account(mut)]
    pub operator: Signer<'info>,
}

pub fn complete_withdraw_handler(ctx: Context<CompleteWithdraw>) -> Result<()> {
    let a = &ctx.accounts.arbitrator;
    require!(
        a.status == ArbitratorStatus::Withdrawing,
        DisputeArbitrationError::NotWithdrawing
    );
    let now = Clock::get()?.unix_timestamp;
    require!(
        now >= a.withdraw_unlock_time,
        DisputeArbitrationError::WithdrawNotReady
    );
    Ok(()) // account closed by Anchor `close = operator`
}
