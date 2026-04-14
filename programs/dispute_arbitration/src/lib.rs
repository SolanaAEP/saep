use anchor_lang::prelude::*;

declare_id!("GM8xiT17USBpCW24XXBmUR8YVCxxrJPMEcsddwfUokMa");

#[program]
pub mod dispute_arbitration {
    use super::*;

    pub fn initialize(_ctx: Context<Initialize>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
