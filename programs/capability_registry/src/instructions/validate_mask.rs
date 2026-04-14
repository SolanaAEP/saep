use anchor_lang::prelude::*;

use crate::state::RegistryConfig;

#[derive(Accounts)]
pub struct ValidateMask<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, RegistryConfig>,
}

pub fn validate_mask_handler(ctx: Context<ValidateMask>, mask: u128) -> Result<()> {
    ctx.accounts.config.assert_mask_approved(mask)
}
