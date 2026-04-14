use anchor_lang::prelude::*;

use crate::errors::TreasuryError;

// PAY-TASK-M1-INERT — TaskMarket M1 uses client-funded escrow directly.
// This handler is kept in the program surface so the M2 wiring is additive,
// but in M1 it always fails so it cannot accidentally move funds.
#[derive(Accounts)]
pub struct PayTask<'info> {
    pub caller: Signer<'info>,
}

pub fn handler(_ctx: Context<PayTask>, _amount: u64) -> Result<()> {
    err!(TreasuryError::PayTaskDisabled)
}
