use anchor_lang::prelude::*;
use solana_instructions_sysvar::ID as IX_SYSVAR_ID;

use proof_verifier::cpi::accounts::VerifyProof;
use proof_verifier::cpi::verify_proof;
use proof_verifier::program::ProofVerifier;
use proof_verifier::state::{GlobalMode, VerifierConfig, VerifierKey};

use crate::errors::TaskMarketError;
use crate::events::{GuardEntered, TaskVerified, VerificationFailed};
use crate::guard::{exit as guard_exit, try_enter, ReentrancyGuard, SEED_GUARD};
use crate::state::{MarketGlobal, TaskContract, TaskStatus};

#[derive(Accounts)]
pub struct VerifyTask<'info> {
    #[account(seeds = [b"market_global"], bump = global.bump)]
    pub global: Box<Account<'info, MarketGlobal>>,

    #[account(
        mut,
        seeds = [b"task", task.client.as_ref(), task.task_nonce.as_ref()],
        bump = task.bump,
    )]
    pub task: Box<Account<'info, TaskContract>>,

    #[account(
        constraint = proof_verifier_program.key() == global.proof_verifier @ TaskMarketError::Unauthorized,
    )]
    pub proof_verifier_program: Program<'info, ProofVerifier>,

    #[account(
        seeds = [b"verifier_config"],
        bump = verifier_config.bump,
        seeds::program = proof_verifier_program.key(),
    )]
    pub verifier_config: Box<Account<'info, VerifierConfig>>,

    #[account(
        seeds = [b"vk", verifier_key.vk_id.as_ref()],
        bump = verifier_key.bump,
        seeds::program = proof_verifier_program.key(),
    )]
    pub verifier_key: Box<Account<'info, VerifierKey>>,

    #[account(
        seeds = [b"mode"],
        bump = verifier_mode.bump,
        seeds::program = proof_verifier_program.key(),
    )]
    pub verifier_mode: Box<Account<'info, GlobalMode>>,

    /// task_market's own reentrancy guard — asserted + held across the CPI.
    #[account(mut, seeds = [SEED_GUARD], bump = guard.bump)]
    pub guard: Box<Account<'info, ReentrancyGuard>>,

    /// proof_verifier's self_guard PDA. Threaded into the CPI.
    /// CHECK: validated by proof_verifier via seeds + ownership.
    pub verifier_self_guard: UncheckedAccount<'info>,

    /// proof_verifier's allowed_callers PDA. Threaded into the CPI.
    /// CHECK: validated by proof_verifier via seeds + ownership.
    pub verifier_allowed_callers: UncheckedAccount<'info>,

    /// CHECK: instructions sysvar, threaded into the CPI.
    #[account(address = IX_SYSVAR_ID)]
    pub instructions: UncheckedAccount<'info>,

    pub cranker: Signer<'info>,
}

fn i64_to_scalar_be(val: i64) -> [u8; 32] {
    let mut buf = [0u8; 32];
    buf[24..32].copy_from_slice(&val.to_be_bytes());
    buf
}

pub fn handler(
    ctx: Context<VerifyTask>,
    proof_a: [u8; 64],
    proof_b: [u8; 128],
    proof_c: [u8; 64],
) -> Result<()> {
    let clock = Clock::get()?;
    try_enter(&mut ctx.accounts.guard, crate::ID, clock.slot)?;
    emit!(GuardEntered {
        program: crate::ID,
        caller: crate::ID,
        slot: clock.slot,
        stack_height: 1,
    });

    let t = &mut ctx.accounts.task;
    require!(
        t.status == TaskStatus::ProofSubmitted,
        TaskMarketError::WrongStatus
    );

    let now = clock.unix_timestamp;

    let public_inputs = vec![
        t.task_hash,
        t.result_hash,
        i64_to_scalar_be(t.deadline),
        i64_to_scalar_be(t.submitted_at),
        t.criteria_root,
    ];

    let cpi_ctx = CpiContext::new(
        ctx.accounts.proof_verifier_program.key(),
        VerifyProof {
            config: ctx.accounts.verifier_config.to_account_info(),
            vk: ctx.accounts.verifier_key.to_account_info(),
            mode: ctx.accounts.verifier_mode.to_account_info(),
            self_guard: ctx.accounts.verifier_self_guard.to_account_info(),
            allowed_callers: ctx.accounts.verifier_allowed_callers.to_account_info(),
            caller_guard: ctx.accounts.guard.to_account_info(),
            instructions: ctx.accounts.instructions.to_account_info(),
        },
    );

    let res = verify_proof(cpi_ctx, proof_a, proof_b, proof_c, public_inputs);

    if res.is_err() {
        emit!(VerificationFailed {
            task_id: t.task_id,
            timestamp: now,
        });
        return err!(TaskMarketError::ProofInvalid);
    }

    let dispute_window_end = t
        .deadline
        .checked_add(ctx.accounts.global.dispute_window_secs)
        .ok_or(TaskMarketError::ArithmeticOverflow)?;

    t.status = TaskStatus::Verified;
    t.verified = true;
    t.dispute_window_end = dispute_window_end;

    emit!(TaskVerified {
        task_id: t.task_id,
        dispute_window_end,
        timestamp: now,
    });

    guard_exit(&mut ctx.accounts.guard);
    Ok(())
}
