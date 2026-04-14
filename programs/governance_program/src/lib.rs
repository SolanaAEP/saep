use anchor_lang::prelude::*;

declare_id!("9uczLDZaN9EWqW76be75ji4vCsz3cydefbChqvBS6qw1");

#[program]
pub mod governance_program {
    use super::*;

    pub fn initialize(_ctx: Context<Initialize>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
