use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod guard;
pub mod instructions;
pub mod state;

#[cfg(test)]
mod fuzz;

use instructions::*;
use state::*;

declare_id!("GM8xiT17USBpCW24XXBmUR8YVCxxrJPMEcsddwfUokMa");

#[program]
pub mod dispute_arbitration {
    use super::*;

    // --- Guard Admin ---

    pub fn initialize(
        ctx: Context<Initialize>,
        params: guard_admin::InitConfigParams,
    ) -> Result<()> {
        guard_admin::initialize_handler(ctx, params)
    }

    pub fn init_guard(ctx: Context<InitGuard>, initial_callers: Vec<Pubkey>) -> Result<()> {
        guard_admin::init_guard_handler(ctx, initial_callers)
    }

    pub fn set_allowed_callers(
        ctx: Context<SetAllowedCallers>,
        programs: Vec<Pubkey>,
    ) -> Result<()> {
        guard_admin::set_allowed_callers_handler(ctx, programs)
    }

    pub fn propose_guard_reset(ctx: Context<ProposeGuardReset>) -> Result<()> {
        guard_admin::propose_guard_reset_handler(ctx)
    }

    pub fn admin_reset_guard(ctx: Context<AdminResetGuard>) -> Result<()> {
        guard_admin::admin_reset_guard_handler(ctx)
    }

    // --- Arbitrator ---

    pub fn register_arbitrator(
        ctx: Context<RegisterArbitrator>,
        effective_stake: u64,
        lock_end: i64,
    ) -> Result<()> {
        arbitrator::register_handler(ctx, effective_stake, lock_end)
    }

    pub fn refresh_stake(
        ctx: Context<RefreshStake>,
        new_stake: u64,
        new_lock_end: i64,
    ) -> Result<()> {
        arbitrator::refresh_stake_handler(ctx, new_stake, new_lock_end)
    }

    pub fn snapshot_pool(
        ctx: Context<SnapshotPool>,
        arbitrators: Vec<Pubkey>,
        stakes: Vec<u64>,
    ) -> Result<()> {
        arbitrator::snapshot_pool_handler(ctx, arbitrators, stakes)
    }

    pub fn begin_withdraw(ctx: Context<BeginWithdraw>) -> Result<()> {
        arbitrator::begin_withdraw_handler(ctx)
    }

    pub fn complete_withdraw(ctx: Context<CompleteWithdraw>) -> Result<()> {
        arbitrator::complete_withdraw_handler(ctx)
    }

    // --- Dispute Lifecycle ---

    pub fn raise_dispute(
        ctx: Context<RaiseDispute>,
        task_id: u64,
        client: Pubkey,
        agent_operator: Pubkey,
        escrow_amount: u64,
        payment_mint: Pubkey,
    ) -> Result<()> {
        dispute::raise_dispute_handler(ctx, task_id, client, agent_operator, escrow_amount, payment_mint)
    }

    pub fn consume_vrf(ctx: Context<ConsumeVrf>, vrf_result: [u8; 32]) -> Result<()> {
        dispute::consume_vrf_handler(ctx, vrf_result)
    }

    pub fn cancel_stale_vrf(ctx: Context<CancelStaleVrf>) -> Result<()> {
        dispute::cancel_stale_vrf_handler(ctx)
    }

    // --- Voting ---

    pub fn commit_vote(ctx: Context<CommitVote>, commit_hash: [u8; 32]) -> Result<()> {
        voting::commit_vote_handler(ctx, commit_hash)
    }

    pub fn reveal_vote(
        ctx: Context<RevealVote>,
        verdict: DisputeVerdict,
        salt: [u8; 32],
    ) -> Result<()> {
        voting::reveal_vote_handler(ctx, verdict, salt)
    }

    pub fn tally_round(ctx: Context<TallyRound>) -> Result<()> {
        voting::tally_round_handler(ctx)
    }

    // --- Resolution ---

    pub fn escalate_appeal(ctx: Context<EscalateAppeal>) -> Result<()> {
        resolution::escalate_appeal_handler(ctx)
    }

    pub fn resolve_dispute(ctx: Context<ResolveDispute>) -> Result<()> {
        resolution::resolve_dispute_handler(ctx)
    }

    // --- Slashing ---

    pub fn slash_arbitrator(ctx: Context<SlashArbitrator>, reason_code: u8) -> Result<()> {
        slashing::slash_arbitrator_handler(ctx, reason_code)
    }

    pub fn execute_slash(ctx: Context<ExecuteSlash>) -> Result<()> {
        slashing::execute_slash_handler(ctx)
    }

    pub fn cancel_slash(ctx: Context<CancelSlash>) -> Result<()> {
        slashing::cancel_slash_handler(ctx)
    }

    // --- Params ---

    pub fn set_params(ctx: Context<SetParams>, input: UpdateParamsInput) -> Result<()> {
        params::set_params_handler(ctx, input)
    }

    pub fn set_paused(ctx: Context<SetDisputePaused>, paused: bool) -> Result<()> {
        params::set_paused_handler(ctx, paused)
    }
}
