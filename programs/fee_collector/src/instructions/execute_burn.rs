use anchor_lang::prelude::*;
use anchor_spl::token_interface::{burn_checked, BurnChecked, Mint, TokenAccount, TokenInterface};

use crate::errors::FeeCollectorError;
use crate::events::BurnExecuted;
use crate::state::*;

#[derive(Accounts)]
#[instruction(epoch_id: u64)]
pub struct ExecuteBurn<'info> {
    #[account(seeds = [SEED_FEE_CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, FeeCollectorConfig>>,

    #[account(
        mut,
        seeds = [SEED_EPOCH, epoch_id.to_le_bytes().as_ref()],
        bump = epoch.bump,
    )]
    pub epoch: Box<Account<'info, EpochAccount>>,

    #[account(mut, address = config.saep_mint)]
    pub saep_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        token::mint = saep_mint,
        seeds = [SEED_BURN_VAULT],
        bump,
    )]
    pub burn_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    pub cranker: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<ExecuteBurn>, epoch_id: u64) -> Result<()> {
    let epoch = &ctx.accounts.epoch;
    require!(
        matches!(
            epoch.status,
            EpochStatus::Splitting | EpochStatus::DistributionCommitted | EpochStatus::Stale
        ),
        FeeCollectorError::InvalidEpochStatus
    );
    require!(!epoch.burn_executed, FeeCollectorError::BurnAlreadyExecuted);
    require!(
        epoch.total_collected >= ctx.accounts.config.min_epoch_total_for_burn,
        FeeCollectorError::BurnBelowThreshold
    );

    let burn_amount = epoch.burn_amount;

    // state-before-CPI
    let epoch = &mut ctx.accounts.epoch;
    epoch.burn_executed = true;

    if burn_amount > 0 {
        // PermanentDelegate PDA signs the burn
        let (_, burn_vault_bump) =
            Pubkey::find_program_address(&[SEED_BURN_VAULT], ctx.program_id);
        let seeds: &[&[u8]] = &[SEED_BURN_VAULT, &[burn_vault_bump]];
        let signer = &[seeds];

        burn_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                BurnChecked {
                    mint: ctx.accounts.saep_mint.to_account_info(),
                    from: ctx.accounts.burn_vault.to_account_info(),
                    authority: ctx.accounts.burn_vault.to_account_info(),
                },
                signer,
            ),
            burn_amount,
            ctx.accounts.saep_mint.decimals,
        )?;
    }

    let now = Clock::get()?.unix_timestamp;
    emit!(BurnExecuted {
        epoch_id,
        amount: burn_amount,
        crank: ctx.accounts.cranker.key(),
        timestamp: now,
    });
    Ok(())
}
