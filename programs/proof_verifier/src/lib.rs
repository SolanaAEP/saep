use anchor_lang::prelude::*;

declare_id!("DcJx1p6bcNuFm4i5WMgK4uGZitc1bf4Ubc5d4sctZKVe");

#[program]
pub mod proof_verifier {
    use super::*;

    pub fn initialize(_ctx: Context<Initialize>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
