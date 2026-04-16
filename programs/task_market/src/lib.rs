use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod guard;
pub mod instructions;
pub mod personhood;
pub mod state;

#[cfg(test)]
mod fuzz;

use instructions::*;
use state::{TaskPayload, ALLOWED_MINTS_LEN};

declare_id!("HiyqZ4q1GPPgx1EaxSuyBFKTzoPAYDPmnSfTX1vjbB8w");

#[program]
pub mod task_market {
    use super::*;

    #[allow(clippy::too_many_arguments)]
    pub fn init_global(
        ctx: Context<InitGlobal>,
        authority: Pubkey,
        agent_registry: Pubkey,
        treasury_standard: Pubkey,
        proof_verifier: Pubkey,
        fee_collector: Pubkey,
        solrep_pool: Pubkey,
        protocol_fee_bps: u16,
        solrep_fee_bps: u16,
        dispute_window_secs: i64,
        max_deadline_secs: i64,
        allowed_payment_mints: [Pubkey; ALLOWED_MINTS_LEN],
    ) -> Result<()> {
        instructions::init_global::handler(
            ctx,
            authority,
            agent_registry,
            treasury_standard,
            proof_verifier,
            fee_collector,
            solrep_pool,
            protocol_fee_bps,
            solrep_fee_bps,
            dispute_window_secs,
            max_deadline_secs,
            allowed_payment_mints,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn create_task(
        ctx: Context<CreateTask>,
        task_nonce: [u8; 8],
        agent_did: [u8; 32],
        payment_mint: Pubkey,
        payment_amount: u64,
        payload: TaskPayload,
        criteria_root: [u8; 32],
        deadline: i64,
        milestone_count: u8,
    ) -> Result<()> {
        instructions::create_task::handler(
            ctx,
            task_nonce,
            agent_did,
            payment_mint,
            payment_amount,
            payload,
            criteria_root,
            deadline,
            milestone_count,
        )
    }

    pub fn fund_task(ctx: Context<FundTask>) -> Result<()> {
        instructions::fund_task::handler(ctx)
    }

    pub fn cancel_unfunded_task(ctx: Context<CancelUnfundedTask>) -> Result<()> {
        instructions::cancel_unfunded_task::handler(ctx)
    }

    pub fn submit_result(
        ctx: Context<SubmitResult>,
        result_hash: [u8; 32],
        proof_key: [u8; 32],
    ) -> Result<()> {
        instructions::submit_result::handler(ctx, result_hash, proof_key)
    }

    pub fn verify_task(
        ctx: Context<VerifyTask>,
        proof_a: [u8; 64],
        proof_b: [u8; 128],
        proof_c: [u8; 64],
    ) -> Result<()> {
        instructions::verify_task::handler(ctx, proof_a, proof_b, proof_c)
    }

    pub fn release(ctx: Context<Release>) -> Result<()> {
        instructions::release::handler(ctx)
    }

    pub fn expire(ctx: Context<Expire>) -> Result<()> {
        instructions::expire::handler(ctx)
    }

    pub fn raise_dispute(ctx: Context<RaiseDispute>) -> Result<()> {
        instructions::raise_dispute::handler(ctx)
    }

    pub fn set_allowed_mint(
        ctx: Context<GovernanceUpdate>,
        slot: u8,
        mint: Pubkey,
    ) -> Result<()> {
        instructions::governance::set_allowed_mint_handler(ctx, slot, mint)
    }

    pub fn allow_payment_mint(ctx: Context<AllowPaymentMint>, slot: u8) -> Result<()> {
        instructions::allow_payment_mint::handler(ctx, slot)
    }

    pub fn set_hook_allowlist_ptr(
        ctx: Context<GovernanceUpdate>,
        hook_allowlist: Pubkey,
    ) -> Result<()> {
        instructions::governance::set_hook_allowlist_ptr_handler(ctx, hook_allowlist)
    }

    pub fn set_fees(
        ctx: Context<GovernanceUpdate>,
        protocol_fee_bps: u16,
        solrep_fee_bps: u16,
    ) -> Result<()> {
        instructions::governance::set_fees_handler(ctx, protocol_fee_bps, solrep_fee_bps)
    }

    pub fn set_paused(ctx: Context<GovernanceUpdate>, paused: bool) -> Result<()> {
        instructions::governance::set_paused_handler(ctx, paused)
    }

    pub fn transfer_authority(
        ctx: Context<TransferAuthority>,
        new_authority: Pubkey,
    ) -> Result<()> {
        instructions::authority::transfer_authority_handler(ctx, new_authority)
    }

    pub fn accept_authority(ctx: Context<AcceptAuthority>) -> Result<()> {
        instructions::authority::accept_authority_handler(ctx)
    }

    pub fn open_bidding(
        ctx: Context<OpenBidding>,
        commit_secs: i64,
        reveal_secs: i64,
        bond_bps: u16,
    ) -> Result<()> {
        instructions::open_bidding::handler(ctx, commit_secs, reveal_secs, bond_bps)
    }

    pub fn commit_bid(
        ctx: Context<CommitBid>,
        commit_hash: [u8; 32],
        agent_did: [u8; 32],
    ) -> Result<()> {
        instructions::commit_bid::handler(ctx, commit_hash, agent_did)
    }

    pub fn reveal_bid(
        ctx: Context<RevealBid>,
        amount: u64,
        nonce: [u8; 32],
    ) -> Result<()> {
        instructions::reveal_bid::handler(ctx, amount, nonce)
    }

    pub fn close_bidding<'info>(ctx: Context<'info, CloseBidding<'info>>) -> Result<()> {
        instructions::close_bidding::handler(ctx)
    }

    pub fn claim_bond(ctx: Context<ClaimBond>) -> Result<()> {
        instructions::claim_bond::handler(ctx)
    }

    pub fn cancel_bidding(ctx: Context<CancelBidding>) -> Result<()> {
        instructions::cancel_bidding::handler(ctx)
    }

    pub fn init_guard(
        ctx: Context<InitGuard>,
        initial_callers: Vec<Pubkey>,
    ) -> Result<()> {
        instructions::guard::init_guard_handler(ctx, initial_callers)
    }

    pub fn set_allowed_callers(
        ctx: Context<SetAllowedCallers>,
        programs: Vec<Pubkey>,
    ) -> Result<()> {
        instructions::guard::set_allowed_callers_handler(ctx, programs)
    }

    pub fn propose_guard_reset(ctx: Context<ProposeGuardReset>) -> Result<()> {
        instructions::guard::propose_guard_reset_handler(ctx)
    }

    pub fn admin_reset_guard(ctx: Context<AdminResetGuard>) -> Result<()> {
        instructions::guard::admin_reset_guard_handler(ctx)
    }
}
