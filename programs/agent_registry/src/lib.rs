use anchor_lang::prelude::*;

declare_id!("EQJ4Lp2gxJDD5hs185aDcermYWdAi4cQeSKfnuqLAQYu");

#[program]
pub mod agent_registry {
    use super::*;

    pub fn initialize(_ctx: Context<Initialize>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
