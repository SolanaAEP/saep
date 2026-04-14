use anchor_lang::prelude::*;

declare_id!("4xLpFgjpZwJbf61UyvyMhmEBmeJzPaCyKvZeYuK2YFFu");

#[program]
pub mod fee_collector {
    use super::*;

    pub fn initialize(_ctx: Context<Initialize>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
