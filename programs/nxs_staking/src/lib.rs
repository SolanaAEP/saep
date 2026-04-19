use anchor_lang::prelude::*;
use anchor_spl::token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked};

pub mod errors;
pub mod events;
mod fuzz;
pub mod guard;
pub mod state;

use errors::NxsStakingError;
use guard::{
    assert_reset_timelock, reset_guard, AllowedCallers, ReentrancyGuard, StakingConfig,
    MAX_ALLOWED_CALLERS, SEED_ALLOWED_CALLERS, SEED_GUARD, SEED_STAKING_CONFIG,
};
use state::*;

declare_id!("GjXfJ6MHb6SJ4XBK3qcpGw4n256qYPrDcXrNj6kf2i2Z");

#[program]
pub mod nxs_staking {
    use super::*;

    // ── guard / admin ──────────────────────────────────────────

    pub fn initialize(ctx: Context<Initialize>, authority: Pubkey) -> Result<()> {
        let c = &mut ctx.accounts.config;
        c.authority = authority;
        c.bump = ctx.bumps.config;
        Ok(())
    }

    pub fn init_guard(ctx: Context<InitGuard>, initial_callers: Vec<Pubkey>) -> Result<()> {
        require!(
            initial_callers.len() <= MAX_ALLOWED_CALLERS,
            NxsStakingError::UnauthorizedCaller
        );
        for p in &initial_callers {
            require!(*p != Pubkey::default(), NxsStakingError::UnauthorizedCaller);
        }
        let g = &mut ctx.accounts.guard;
        reset_guard(g);
        g.bump = ctx.bumps.guard;

        let a = &mut ctx.accounts.allowed_callers;
        a.programs = initial_callers;
        a.bump = ctx.bumps.allowed_callers;
        Ok(())
    }

    pub fn set_allowed_callers(
        ctx: Context<SetAllowedCallers>,
        programs: Vec<Pubkey>,
    ) -> Result<()> {
        require!(
            programs.len() <= MAX_ALLOWED_CALLERS,
            NxsStakingError::UnauthorizedCaller
        );
        for p in &programs {
            require!(*p != Pubkey::default(), NxsStakingError::UnauthorizedCaller);
        }
        ctx.accounts.allowed_callers.programs = programs;
        Ok(())
    }

    pub fn propose_guard_reset(ctx: Context<ProposeGuardReset>) -> Result<()> {
        ctx.accounts.guard.reset_proposed_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    pub fn admin_reset_guard(ctx: Context<AdminResetGuard>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        assert_reset_timelock(&ctx.accounts.guard, now)?;
        reset_guard(&mut ctx.accounts.guard);
        Ok(())
    }

    // ── staking ────────────────────────────────────────────────

    pub fn init_pool(
        ctx: Context<InitPool>,
        stake_mint: Pubkey,
        epoch_duration_secs: i64,
        reward_rate_per_epoch: u64,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let pool = &mut ctx.accounts.pool;
        pool.authority = ctx.accounts.authority.key();
        pool.pending_authority = None;
        pool.stake_mint = stake_mint;
        pool.total_staked = 0;
        pool.total_stakers = 0;
        pool.current_epoch = 0;
        pool.epoch_duration_secs = epoch_duration_secs;
        pool.epoch_start_time = now;
        pool.reward_rate_per_epoch = reward_rate_per_epoch;
        pool.paused = false;
        pool.pause_new_stakes = false;
        pool.pause_new_stakes_at = 0;
        pool.closed = false;
        pool.closed_at = 0;
        pool.bump = ctx.bumps.pool;

        emit!(events::PoolInitialized {
            authority: ctx.accounts.authority.key(),
            stake_mint,
            epoch_duration_secs,
            timestamp: now,
        });
        Ok(())
    }

    pub fn stake(ctx: Context<StakeTokens>, amount: u64, lockup_duration_secs: i64) -> Result<()> {
        require!(!ctx.accounts.pool.paused, NxsStakingError::Paused);
        require!(!ctx.accounts.pool.closed, NxsStakingError::PoolClosed);
        require!(
            !ctx.accounts.pool.pause_new_stakes,
            NxsStakingError::DepositsFrozen,
        );
        require!(amount > 0, NxsStakingError::ZeroAmount);
        require!(
            lockup_duration_secs >= MIN_LOCKUP_SECS && lockup_duration_secs <= MAX_LOCKUP_SECS,
            NxsStakingError::InvalidLockup,
        );

        let now = Clock::get()?.unix_timestamp;
        let multiplier = compute_multiplier(lockup_duration_secs);
        let voting_power = compute_voting_power(amount, multiplier);

        let cpi = TransferChecked {
            from: ctx.accounts.owner_token_account.to_account_info(),
            mint: ctx.accounts.stake_mint.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.owner.to_account_info(),
        };
        transfer_checked(
            CpiContext::new(ctx.accounts.token_program.key(), cpi),
            amount,
            ctx.accounts.stake_mint.decimals,
        )?;

        let sa = &mut ctx.accounts.stake_account;
        sa.owner = ctx.accounts.owner.key();
        sa.pool = ctx.accounts.pool.key();
        sa.amount = amount;
        sa.lockup_end = now
            .checked_add(lockup_duration_secs)
            .ok_or(NxsStakingError::ArithmeticOverflow)?;
        sa.lockup_multiplier = multiplier;
        sa.voting_power = voting_power;
        sa.staked_at = now;
        sa.cooldown_start = 0;
        sa.pending_rewards = 0;
        sa.last_claim_epoch = ctx.accounts.pool.current_epoch;
        sa.status = StakeStatus::Active;
        sa.bump = ctx.bumps.stake_account;
        sa.vault_bump = ctx.bumps.vault;

        let pool = &mut ctx.accounts.pool;
        pool.total_staked = pool
            .total_staked
            .checked_add(amount)
            .ok_or(NxsStakingError::ArithmeticOverflow)?;
        pool.total_stakers = pool.total_stakers.saturating_add(1);

        emit!(events::Staked {
            owner: ctx.accounts.owner.key(),
            amount,
            lockup_end: sa.lockup_end,
            voting_power,
            multiplier,
            timestamp: now,
        });
        Ok(())
    }

    pub fn begin_unstake(ctx: Context<BeginUnstake>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(!ctx.accounts.pool.closed, NxsStakingError::PoolClosed);
        let sa = &ctx.accounts.stake_account;

        require!(sa.status == StakeStatus::Active, NxsStakingError::NotActive);
        require!(now >= sa.lockup_end, NxsStakingError::LockupNotEnded);

        let sa = &mut ctx.accounts.stake_account;
        sa.status = StakeStatus::Cooldown;
        sa.cooldown_start = now;

        let pool = &mut ctx.accounts.pool;
        pool.total_staked = pool.total_staked.saturating_sub(sa.amount);

        let cooldown_end = now
            .checked_add(COOLDOWN_SECS)
            .ok_or(NxsStakingError::ArithmeticOverflow)?;

        emit!(events::UnstakeInitiated {
            owner: ctx.accounts.owner.key(),
            amount: sa.amount,
            cooldown_end,
            timestamp: now,
        });
        Ok(())
    }

    pub fn withdraw(ctx: Context<WithdrawStake>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let sa = &ctx.accounts.stake_account;

        require!(
            sa.status == StakeStatus::Cooldown,
            NxsStakingError::NotInCooldown
        );
        let cooldown_end = sa
            .cooldown_start
            .checked_add(COOLDOWN_SECS)
            .ok_or(NxsStakingError::ArithmeticOverflow)?;
        require!(now >= cooldown_end, NxsStakingError::CooldownNotEnded);

        let amount = sa.amount;
        let stake_account_key = ctx.accounts.stake_account.key();
        let seeds: &[&[u8]] = &[
            b"stake_vault",
            stake_account_key.as_ref(),
            core::slice::from_ref(&sa.vault_bump),
        ];
        let signer = &[seeds];

        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.stake_mint.to_account_info(),
                    to: ctx.accounts.owner_token_account.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                signer,
            ),
            amount,
            ctx.accounts.stake_mint.decimals,
        )?;

        let sa = &mut ctx.accounts.stake_account;
        sa.status = StakeStatus::Withdrawn;
        sa.amount = 0;
        sa.voting_power = 0;

        let pool = &mut ctx.accounts.pool;
        pool.total_stakers = pool.total_stakers.saturating_sub(1);

        emit!(events::Withdrawn {
            owner: ctx.accounts.owner.key(),
            amount,
            timestamp: now,
        });
        Ok(())
    }

    pub fn freeze_deposits(ctx: Context<FreezeDeposits>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let pool = &mut ctx.accounts.pool;
        require!(!pool.pause_new_stakes, NxsStakingError::DepositsFrozen);
        pool.pause_new_stakes = true;
        pool.pause_new_stakes_at = now;

        emit!(events::DepositsFrozen {
            pool: pool.key(),
            authority: ctx.accounts.authority.key(),
            pause_new_stakes_at: now,
            timestamp: now,
        });
        Ok(())
    }

    pub fn unfreeze_deposits(ctx: Context<UnfreezeDeposits>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let pool = &mut ctx.accounts.pool;
        require!(pool.pause_new_stakes, NxsStakingError::DepositsNotFrozen);
        pool.pause_new_stakes = false;
        pool.pause_new_stakes_at = 0;

        emit!(events::DepositsUnfrozen {
            pool: pool.key(),
            authority: ctx.accounts.authority.key(),
            timestamp: now,
        });
        Ok(())
    }

    pub fn close_pool(ctx: Context<ClosePool>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let pool = &mut ctx.accounts.pool;
        require!(!pool.closed, NxsStakingError::PoolClosed);

        let window_elapsed = pool.pause_new_stakes
            && now
                >= pool
                    .pause_new_stakes_at
                    .checked_add(MIGRATION_WINDOW_SECS)
                    .ok_or(NxsStakingError::ArithmeticOverflow)?;
        require!(
            pool.total_staked == 0 || window_elapsed,
            NxsStakingError::MigrationWindowActive,
        );

        pool.closed = true;
        pool.closed_at = now;

        emit!(events::PoolClosed {
            pool: pool.key(),
            authority: ctx.accounts.authority.key(),
            total_staked_at_close: pool.total_staked,
            closed_at: now,
        });
        Ok(())
    }

    pub fn migrate_apy_authority(
        _ctx: Context<MigrateApyAuthority>,
        old_mint: Pubkey,
        new_mint: Pubkey,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        emit!(events::ApyAuthorityMigrated {
            old_mint,
            new_mint,
            attested_at: now,
        });
        Ok(())
    }

    pub fn snapshot_epoch(
        ctx: Context<SnapshotEpoch>,
        total_voting_power: u128,
        staker_count: u32,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let pool = &ctx.accounts.pool;
        require!(!pool.closed, NxsStakingError::PoolClosed);

        let epoch_end = pool
            .epoch_start_time
            .checked_add(pool.epoch_duration_secs)
            .ok_or(NxsStakingError::ArithmeticOverflow)?;
        require!(now >= epoch_end, NxsStakingError::EpochNotEnded);

        let snap = &mut ctx.accounts.snapshot;
        snap.epoch = pool.current_epoch;
        snap.total_voting_power = total_voting_power;
        snap.snapshot_time = now;
        snap.staker_count = staker_count;
        snap.bump = ctx.bumps.snapshot;

        emit!(events::EpochSnapshotted {
            epoch: pool.current_epoch,
            total_voting_power,
            staker_count,
            timestamp: now,
        });

        let pool = &mut ctx.accounts.pool;
        pool.current_epoch = pool
            .current_epoch
            .checked_add(1)
            .ok_or(NxsStakingError::ArithmeticOverflow)?;
        pool.epoch_start_time = now;

        Ok(())
    }
}

// ── guard account structs ──────────────────────────────────────

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + StakingConfig::INIT_SPACE,
        seeds = [SEED_STAKING_CONFIG],
        bump,
    )]
    pub config: Account<'info, StakingConfig>,

    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitGuard<'info> {
    #[account(
        seeds = [SEED_STAKING_CONFIG],
        bump = config.bump,
        has_one = authority @ NxsStakingError::Unauthorized,
    )]
    pub config: Account<'info, StakingConfig>,

    #[account(
        init,
        payer = authority,
        space = 8 + ReentrancyGuard::INIT_SPACE,
        seeds = [SEED_GUARD],
        bump,
    )]
    pub guard: Account<'info, ReentrancyGuard>,

    #[account(
        init,
        payer = authority,
        space = 8 + AllowedCallers::INIT_SPACE,
        seeds = [SEED_ALLOWED_CALLERS],
        bump,
    )]
    pub allowed_callers: Account<'info, AllowedCallers>,

    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetAllowedCallers<'info> {
    #[account(
        seeds = [SEED_STAKING_CONFIG],
        bump = config.bump,
        has_one = authority @ NxsStakingError::Unauthorized,
    )]
    pub config: Account<'info, StakingConfig>,

    #[account(mut, seeds = [SEED_ALLOWED_CALLERS], bump = allowed_callers.bump)]
    pub allowed_callers: Account<'info, AllowedCallers>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ProposeGuardReset<'info> {
    #[account(
        seeds = [SEED_STAKING_CONFIG],
        bump = config.bump,
        has_one = authority @ NxsStakingError::Unauthorized,
    )]
    pub config: Account<'info, StakingConfig>,

    #[account(mut, seeds = [SEED_GUARD], bump = guard.bump)]
    pub guard: Account<'info, ReentrancyGuard>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct AdminResetGuard<'info> {
    #[account(
        seeds = [SEED_STAKING_CONFIG],
        bump = config.bump,
        has_one = authority @ NxsStakingError::Unauthorized,
    )]
    pub config: Account<'info, StakingConfig>,

    #[account(mut, seeds = [SEED_GUARD], bump = guard.bump)]
    pub guard: Account<'info, ReentrancyGuard>,

    pub authority: Signer<'info>,
}

// ── staking account structs ────────────────────────────────────

#[derive(Accounts)]
pub struct InitPool<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + StakingPool::INIT_SPACE,
        seeds = [b"staking_pool"],
        bump,
    )]
    pub pool: Box<Account<'info, StakingPool>>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct StakeTokens<'info> {
    #[account(
        mut,
        seeds = [b"staking_pool"],
        bump = pool.bump,
    )]
    pub pool: Box<Account<'info, StakingPool>>,

    #[account(
        init,
        payer = owner,
        space = 8 + StakeAccount::INIT_SPACE,
        seeds = [b"stake", pool.key().as_ref(), owner.key().as_ref()],
        bump,
    )]
    pub stake_account: Box<Account<'info, StakeAccount>>,

    #[account(address = pool.stake_mint)]
    pub stake_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = owner,
        token::mint = stake_mint,
        token::authority = vault,
        seeds = [b"stake_vault", stake_account.key().as_ref()],
        bump,
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, token::mint = stake_mint)]
    pub owner_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BeginUnstake<'info> {
    #[account(
        mut,
        seeds = [b"staking_pool"],
        bump = pool.bump,
    )]
    pub pool: Box<Account<'info, StakingPool>>,

    #[account(
        mut,
        seeds = [b"stake", pool.key().as_ref(), owner.key().as_ref()],
        bump = stake_account.bump,
        has_one = owner @ NxsStakingError::Unauthorized,
    )]
    pub stake_account: Box<Account<'info, StakeAccount>>,

    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct WithdrawStake<'info> {
    #[account(
        mut,
        seeds = [b"staking_pool"],
        bump = pool.bump,
    )]
    pub pool: Box<Account<'info, StakingPool>>,

    #[account(
        mut,
        seeds = [b"stake", pool.key().as_ref(), owner.key().as_ref()],
        bump = stake_account.bump,
        has_one = owner @ NxsStakingError::Unauthorized,
    )]
    pub stake_account: Box<Account<'info, StakeAccount>>,

    #[account(address = pool.stake_mint)]
    pub stake_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        seeds = [b"stake_vault", stake_account.key().as_ref()],
        bump = stake_account.vault_bump,
        token::mint = stake_mint,
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, token::mint = stake_mint)]
    pub owner_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub owner: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct FreezeDeposits<'info> {
    #[account(
        mut,
        seeds = [b"staking_pool"],
        bump = pool.bump,
        has_one = authority @ NxsStakingError::Unauthorized,
    )]
    pub pool: Box<Account<'info, StakingPool>>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct UnfreezeDeposits<'info> {
    #[account(
        mut,
        seeds = [b"staking_pool"],
        bump = pool.bump,
        has_one = authority @ NxsStakingError::Unauthorized,
    )]
    pub pool: Box<Account<'info, StakingPool>>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ClosePool<'info> {
    #[account(
        mut,
        seeds = [b"staking_pool"],
        bump = pool.bump,
        has_one = authority @ NxsStakingError::Unauthorized,
    )]
    pub pool: Box<Account<'info, StakingPool>>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct MigrateApyAuthority<'info> {
    #[account(
        seeds = [SEED_STAKING_CONFIG],
        bump = config.bump,
        has_one = authority @ NxsStakingError::Unauthorized,
    )]
    pub config: Account<'info, StakingConfig>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct SnapshotEpoch<'info> {
    #[account(
        mut,
        seeds = [b"staking_pool"],
        bump = pool.bump,
    )]
    pub pool: Box<Account<'info, StakingPool>>,

    #[account(
        init,
        payer = cranker,
        space = 8 + VotingPowerSnapshot::INIT_SPACE,
        seeds = [b"epoch_snapshot", pool.current_epoch.to_le_bytes().as_ref()],
        bump,
    )]
    pub snapshot: Box<Account<'info, VotingPowerSnapshot>>,

    #[account(mut)]
    pub cranker: Signer<'info>,

    pub system_program: Program<'info, System>,
}
