use anchor_lang::prelude::*;

use crate::errors::GovernanceError;
use crate::events::ProposalExecuted;
use crate::state::*;

#[derive(Accounts)]
pub struct QueueExecution<'info> {
    #[account(
        mut,
        seeds = [SEED_PROPOSAL, proposal.proposal_id.to_le_bytes().as_ref()],
        bump = proposal.bump,
    )]
    pub proposal: Box<Account<'info, ProposalAccount>>,

    pub cranker: Signer<'info>,
}

pub fn queue_handler(ctx: Context<QueueExecution>) -> Result<()> {
    let p = &ctx.accounts.proposal;
    require!(
        p.status == ProposalStatus::Passed,
        GovernanceError::InvalidProposalStatus
    );

    let now = Clock::get()?.unix_timestamp;
    require!(
        now >= p.executable_at,
        GovernanceError::TimelockNotElapsed
    );

    ctx.accounts.proposal.status = ProposalStatus::Queued;
    Ok(())
}

#[derive(Accounts)]
pub struct ExecuteProposal<'info> {
    #[account(seeds = [SEED_GOV_CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, GovernanceConfig>>,

    #[account(seeds = [SEED_PROGRAM_REGISTRY], bump = registry.bump)]
    pub registry: Box<Account<'info, ProgramRegistry>>,

    #[account(
        mut,
        seeds = [SEED_PROPOSAL, proposal.proposal_id.to_le_bytes().as_ref()],
        bump = proposal.bump,
    )]
    pub proposal: Box<Account<'info, ProposalAccount>>,

    #[account(
        init,
        payer = executor,
        space = 8 + ExecutionRecord::INIT_SPACE,
        seeds = [SEED_EXECUTION, proposal.key().as_ref()],
        bump,
    )]
    pub execution_record: Box<Account<'info, ExecutionRecord>>,

    #[account(mut)]
    pub executor: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn execute_handler(ctx: Context<ExecuteProposal>) -> Result<()> {
    let p = &ctx.accounts.proposal;
    require!(
        p.status == ProposalStatus::Queued,
        GovernanceError::InvalidProposalStatus
    );

    let now = Clock::get()?.unix_timestamp;
    let execution_deadline = p
        .executable_at
        .checked_add(EXECUTION_WINDOW_SECS)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    require!(
        now <= execution_deadline,
        GovernanceError::ExecutionWindowExpired
    );

    // verify target is still registered
    let target = p.target_program;
    let registered = ctx
        .accounts
        .registry
        .entries
        .iter()
        .any(|e| e.program_id == target);

    let payload_hash = solana_sha256_hasher::hashv(&[&p.ix_data]).to_bytes();

    // state-before-CPI
    let p = &mut ctx.accounts.proposal;
    p.executed_at = now;

    let result = if !registered {
        p.status = ProposalStatus::Failed;
        ExecutionResult::TargetMissing
    } else {
        // actual CPI dispatch happens via remaining_accounts pattern
        // the executor passes the target program + accounts needed
        // for M2 we record success — real CPI wiring lands with program-specific handlers
        p.status = ProposalStatus::Executed;
        ExecutionResult::Ok
    };

    let rec = &mut ctx.accounts.execution_record;
    rec.proposal_id = p.proposal_id;
    rec.executed_at = now;
    rec.result = result;
    rec.cpi_target = target;
    rec.cpi_payload_hash = payload_hash;
    rec.bump = ctx.bumps.execution_record;

    emit!(ProposalExecuted {
        proposal_id: p.proposal_id,
        cpi_target: target,
        success: matches!(result, ExecutionResult::Ok),
        timestamp: now,
    });
    Ok(())
}
