use anchor_lang::prelude::*;

declare_id!("6boJQg4L6FRS7YZ5rFXfKUaXSy3eCKnW2SdrT3LJLizQ");

#[program]
pub mod treasury_standard {
    use super::*;

    pub fn initialize(_ctx: Context<Initialize>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
