use anchor_lang::prelude::*;

use agent_registry::program::AgentRegistry;
use agent_registry::state::{AgentAccount, AgentStatus, RegistryGlobal};

use crate::errors::TaskMarketError;
use crate::events::TaskCreated;
use crate::state::{
    compute_fees, compute_task_id, is_allowed_mint, MarketGlobal, TaskContract,
    TaskStatus, MAX_MILESTONES, MIN_DEADLINE_SECS,
};

#[derive(Accounts)]
#[instruction(task_nonce: [u8; 8])]
pub struct CreateTask<'info> {
    #[account(seeds = [b"market_global"], bump = global.bump)]
    pub global: Account<'info, MarketGlobal>,

    #[account(
        init,
        payer = client,
        space = 8 + TaskContract::INIT_SPACE,
        seeds = [b"task", client.key().as_ref(), task_nonce.as_ref()],
        bump,
    )]
    pub task: Account<'info, TaskContract>,

    #[account(mut)]
    pub client: Signer<'info>,

    #[account(
        constraint = agent_registry_program.key() == global.agent_registry @ TaskMarketError::Unauthorized,
    )]
    pub agent_registry_program: Program<'info, AgentRegistry>,

    #[account(
        seeds = [b"global"],
        bump = registry_global.bump,
        seeds::program = agent_registry_program.key(),
    )]
    pub registry_global: Account<'info, RegistryGlobal>,

    #[account(
        seeds = [b"agent", agent_account.operator.as_ref(), agent_account.agent_id.as_ref()],
        bump = agent_account.bump,
        seeds::program = agent_registry_program.key(),
    )]
    pub agent_account: Account<'info, AgentAccount>,

    pub system_program: Program<'info, System>,
}

#[allow(clippy::too_many_arguments)]
pub fn handler(
    ctx: Context<CreateTask>,
    task_nonce: [u8; 8],
    agent_did: [u8; 32],
    payment_mint: Pubkey,
    payment_amount: u64,
    task_hash: [u8; 32],
    criteria_root: [u8; 32],
    deadline: i64,
    milestone_count: u8,
) -> Result<()> {
    let g = &ctx.accounts.global;
    require!(!g.paused, TaskMarketError::Paused);
    require!(
        is_allowed_mint(&g.allowed_payment_mints, &payment_mint),
        TaskMarketError::MintNotAllowed
    );
    require!(payment_amount > 0, TaskMarketError::InvalidAmount);
    require!(milestone_count <= MAX_MILESTONES, TaskMarketError::TooManyMilestones);

    let now = Clock::get()?.unix_timestamp;
    let min_deadline = now
        .checked_add(MIN_DEADLINE_SECS)
        .ok_or(TaskMarketError::ArithmeticOverflow)?;
    let max_deadline = now
        .checked_add(g.max_deadline_secs)
        .ok_or(TaskMarketError::ArithmeticOverflow)?;
    require!(deadline > min_deadline, TaskMarketError::InvalidDeadline);
    require!(deadline <= max_deadline, TaskMarketError::DeadlineTooFar);

    let agent = &ctx.accounts.agent_account;
    require!(agent.did == agent_did, TaskMarketError::AgentMismatch);
    require!(agent.status == AgentStatus::Active, TaskMarketError::AgentNotActive);
    require!(
        agent.stake_amount >= ctx.accounts.registry_global.min_stake,
        TaskMarketError::InsufficientStake,
    );

    let (protocol_fee, solrep_fee) =
        compute_fees(payment_amount, g.protocol_fee_bps, g.solrep_fee_bps)?;

    let task_id = compute_task_id(&ctx.accounts.client.key(), &task_nonce, now);

    let t = &mut ctx.accounts.task;
    t.task_id = task_id;
    t.client = ctx.accounts.client.key();
    t.agent_did = agent_did;
    t.task_nonce = task_nonce;
    t.payment_mint = payment_mint;
    t.payment_amount = payment_amount;
    t.protocol_fee = protocol_fee;
    t.solrep_fee = solrep_fee;
    t.task_hash = task_hash;
    t.result_hash = [0u8; 32];
    t.proof_key = [0u8; 32];
    t.criteria_root = criteria_root;
    t.milestone_count = milestone_count;
    t.milestones_complete = 0;
    t.status = TaskStatus::Created;
    t.created_at = now;
    t.funded_at = 0;
    t.deadline = deadline;
    t.submitted_at = 0;
    t.dispute_window_end = 0;
    t.verified = false;
    t.bump = ctx.bumps.task;
    t.escrow_bump = 0;

    emit!(TaskCreated {
        task_id,
        client: ctx.accounts.client.key(),
        agent_did,
        payment_amount,
        deadline,
        timestamp: now,
    });
    Ok(())
}
