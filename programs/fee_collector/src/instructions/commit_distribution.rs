use anchor_lang::prelude::*;

use crate::errors::FeeCollectorError;
use crate::events::DistributionRootCommitted;
use crate::state::*;

#[derive(Accounts)]
#[instruction(epoch_id: u64)]
pub struct CommitDistributionRoot<'info> {
    #[account(seeds = [SEED_FEE_CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, FeeCollectorConfig>>,

    #[account(
        mut,
        seeds = [SEED_EPOCH, epoch_id.to_le_bytes().as_ref()],
        bump = epoch.bump,
    )]
    pub epoch: Box<Account<'info, EpochAccount>>,

    pub committer: Signer<'info>,
}

pub fn handler(
    ctx: Context<CommitDistributionRoot>,
    epoch_id: u64,
    root: [u8; 32],
    leaf_count: u32,
    total_weight: u64,
) -> Result<()> {
    let epoch = &ctx.accounts.epoch;
    require!(
        epoch.status == EpochStatus::Splitting,
        FeeCollectorError::InvalidEpochStatus
    );
    require!(
        !epoch.staker_distribution_committed,
        FeeCollectorError::DistributionAlreadyCommitted
    );

    let now = Clock::get()?.unix_timestamp;
    let closed_ts = epoch.closed_at_ts.unwrap_or(0);
    let deadline = closed_ts
        .checked_add(DISTRIBUTION_WINDOW_SECS)
        .ok_or(FeeCollectorError::ArithmeticOverflow)?;
    require!(
        now < deadline,
        FeeCollectorError::DistributionWindowElapsed
    );

    let epoch = &mut ctx.accounts.epoch;
    epoch.staker_distribution_root = root;
    epoch.staker_distribution_committed = true;
    epoch.status = EpochStatus::DistributionCommitted;

    emit!(DistributionRootCommitted {
        epoch_id,
        root,
        leaf_count,
        total_weight,
        committer: ctx.accounts.committer.key(),
        timestamp: now,
    });
    Ok(())
}
