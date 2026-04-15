use anchor_lang::prelude::*;
use agent_registry::cpi::accounts::RecordJobOutcome;
use agent_registry::cpi::record_job_outcome;

pub use agent_registry::instructions::JobOutcome;

pub fn call_record_job_outcome<'info>(
    agent_registry_program: &Pubkey,
    registry_global: AccountInfo<'info>,
    agent_account: AccountInfo<'info>,
    self_program: AccountInfo<'info>,
    market_global: AccountInfo<'info>,
    market_global_bump: u8,
    outcome: JobOutcome,
) -> Result<()> {
    let seeds: &[&[u8]] = &[b"market_global", &[market_global_bump]];
    let signer = &[seeds];

    let cpi_ctx = CpiContext::new_with_signer(
        *agent_registry_program,
        RecordJobOutcome {
            global: registry_global,
            agent: agent_account,
            task_market_program: self_program,
            task_market_authority: market_global,
        },
        signer,
    );

    record_job_outcome(cpi_ctx, outcome)
}
