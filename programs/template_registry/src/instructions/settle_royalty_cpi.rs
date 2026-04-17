use anchor_lang::prelude::*;
use anchor_spl::token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::errors::TemplateRegistryError;
use crate::events::RoyaltySettled;
use crate::state::{AgentTemplate, TemplateFork, TemplateRegistryGlobal, TemplateStatus};

/// CPI-only: called by treasury_standard on agent settlement to deduct
/// royalty from gross payout and route it to the template author.
#[derive(Accounts)]
pub struct SettleRoyaltyCpi<'info> {
    #[account(seeds = [b"tpl_global"], bump = global.bump)]
    pub global: Box<Account<'info, TemplateRegistryGlobal>>,

    #[account(
        mut,
        seeds = [b"template", template.template_id.as_ref()],
        bump = template.bump,
    )]
    pub template: Box<Account<'info, AgentTemplate>>,

    #[account(
        seeds = [b"fork", fork.child_agent_did.as_ref()],
        bump = fork.bump,
        constraint = fork.parent_template == template.key() @ TemplateRegistryError::InvalidCpiCaller,
    )]
    pub fork: Box<Account<'info, TemplateFork>>,

    pub mint: Box<InterfaceAccount<'info, Mint>>,

    /// The agent's vault holding gross payout (authority = treasury PDA)
    #[account(mut, token::mint = mint)]
    pub source: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, token::mint = mint)]
    pub author_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// treasury_standard PDA that signs the CPI
    pub settler: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<SettleRoyaltyCpi>, gross_amount: u64) -> Result<()> {
    let template = &ctx.accounts.template;
    require!(
        template.status != TemplateStatus::Retired,
        TemplateRegistryError::InvalidStatus,
    );

    let royalty_bps = ctx.accounts.fork.royalty_bps_snapshot as u64;
    let royalty = gross_amount
        .checked_mul(royalty_bps)
        .and_then(|v| v.checked_div(10_000))
        .ok_or(TemplateRegistryError::ArithmeticOverflow)?;

    if royalty > 0 {
        let cpi = TransferChecked {
            from: ctx.accounts.source.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.author_token_account.to_account_info(),
            authority: ctx.accounts.settler.to_account_info(),
        };
        transfer_checked(
            CpiContext::new(ctx.accounts.token_program.key(), cpi),
            royalty,
            ctx.accounts.mint.decimals,
        )?;
    }

    let template = &mut ctx.accounts.template;
    template.total_revenue = template.total_revenue.saturating_add(royalty);

    emit!(RoyaltySettled {
        template: ctx.accounts.template.key(),
        gross: gross_amount,
        royalty,
        settler: ctx.accounts.settler.key(),
    });

    Ok(())
}
