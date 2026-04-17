use anchor_lang::prelude::*;
use anchor_spl::token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::errors::FeeCollectorError;
use crate::events::StakerClaimed;
use crate::state::*;

#[derive(Accounts)]
#[instruction(epoch_id: u64)]
pub struct ClaimStaker<'info> {
    #[account(seeds = [SEED_FEE_CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, FeeCollectorConfig>>,

    #[account(
        mut,
        seeds = [SEED_EPOCH, epoch_id.to_le_bytes().as_ref()],
        bump = epoch.bump,
    )]
    pub epoch: Box<Account<'info, EpochAccount>>,

    #[account(
        init,
        payer = staker,
        space = 8 + StakerClaim::INIT_SPACE,
        seeds = [SEED_CLAIM, epoch_id.to_le_bytes().as_ref(), staker.key().as_ref()],
        bump,
    )]
    pub claim: Box<Account<'info, StakerClaim>>,

    #[account(address = config.saep_mint)]
    pub saep_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        token::mint = saep_mint,
        seeds = [SEED_STAKER_VAULT],
        bump,
    )]
    pub staker_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, token::mint = saep_mint)]
    pub staker_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    pub staker: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<ClaimStaker>,
    epoch_id: u64,
    amount: u64,
    merkle_proof: Vec<[u8; 32]>,
) -> Result<()> {
    require!(
        merkle_proof.len() <= MAX_MERKLE_PROOF_DEPTH,
        FeeCollectorError::MerkleProofTooDeep
    );

    let epoch = &ctx.accounts.epoch;
    require!(
        epoch.status == EpochStatus::DistributionCommitted,
        FeeCollectorError::InvalidEpochStatus
    );

    let now = Clock::get()?;
    let closed_ts = epoch.closed_at_ts.unwrap_or(0);
    let claim_deadline = closed_ts
        .checked_add(ctx.accounts.config.claim_window_secs)
        .ok_or(FeeCollectorError::ArithmeticOverflow)?;
    require!(
        now.unix_timestamp < claim_deadline,
        FeeCollectorError::ClaimWindowElapsed
    );

    let leaf = compute_claim_leaf(&ctx.accounts.staker.key(), amount, epoch_id);
    require!(
        verify_merkle_proof(&merkle_proof, &epoch.staker_distribution_root, leaf),
        FeeCollectorError::MerkleProofInvalid
    );

    let new_total = epoch
        .staker_claimed_total
        .checked_add(amount)
        .ok_or(FeeCollectorError::ArithmeticOverflow)?;
    require!(
        new_total <= epoch.staker_amount,
        FeeCollectorError::ClaimOverflow
    );

    // state-before-CPI
    let epoch = &mut ctx.accounts.epoch;
    epoch.staker_claimed_total = new_total;

    let c = &mut ctx.accounts.claim;
    c.epoch_id = epoch_id;
    c.staker = ctx.accounts.staker.key();
    c.amount_claimed = amount;
    c.claimed_at_slot = now.slot;
    c.bump = ctx.bumps.claim;

    // transfer from staker_vault
    let (_, vault_bump) =
        Pubkey::find_program_address(&[SEED_STAKER_VAULT], ctx.program_id);
    let vault_seeds: &[&[u8]] = &[SEED_STAKER_VAULT, &[vault_bump]];
    let signer = &[vault_seeds];

    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.staker_vault.to_account_info(),
                mint: ctx.accounts.saep_mint.to_account_info(),
                to: ctx.accounts.staker_token_account.to_account_info(),
                authority: ctx.accounts.staker_vault.to_account_info(),
            },
            signer,
        ),
        amount,
        ctx.accounts.saep_mint.decimals,
    )?;

    emit!(StakerClaimed {
        epoch_id,
        staker: ctx.accounts.staker.key(),
        amount,
        timestamp: now.unix_timestamp,
    });
    Ok(())
}
