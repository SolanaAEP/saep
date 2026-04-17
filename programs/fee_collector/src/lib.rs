use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod guard;
pub mod hook;
pub mod instructions;
pub mod state;

#[cfg(test)]
mod fuzz;

pub use errors::FeeCollectorError;
pub use hook::{
    assert_hook_allowed, assert_hook_allowed_at_site, get_transfer_hook_program_id,
    inspect_mint_extensions, MintExtensionReport,
};
pub use state::{
    AgentHookAllowlist, EpochAccount, EpochStatus, FeeCollectorConfig, HookAllowlist,
    StakerClaim, MAX_AGENT_HOOK_PROGRAMS, MAX_HOOK_PROGRAMS, MINT_FLAG_ALL, MINT_FLAG_HOOK_OK,
    MINT_FLAG_NO_FROZEN_DEFAULT, MINT_FLAG_NO_PERMANENT_DELEGATE, MINT_FLAG_NO_TRANSFER_FEE,
    SEED_AGENT_HOOKS, SEED_HOOK_ALLOWLIST, SITE_CLAIM_BOND_REFUND, SITE_CLAIM_BOND_SLASH,
    SITE_COMMIT_BID_BOND, SITE_EXPIRE, SITE_FUND_TASK, SITE_FUND_TREASURY, SITE_INIT_STREAM,
    SITE_RELEASE, SITE_STREAM_CLOSE, SITE_STREAM_SWAP, SITE_STREAM_WITHDRAW, SITE_WITHDRAW,
};

use instructions::*;

declare_id!("4xLpFgjpZwJbf61UyvyMhmEBmeJzPaCyKvZeYuK2YFFu");

#[program]
pub mod fee_collector {
    use super::*;

    // ── hook allowlist ─────────────────────────────────────────

    pub fn init_hook_allowlist(
        ctx: Context<InitHookAllowlist>,
        default_deny: bool,
    ) -> Result<()> {
        instructions::hook_allowlist::init_handler(ctx, default_deny)
    }

    pub fn update_hook_allowlist(
        ctx: Context<UpdateHookAllowlist>,
        add: Vec<Pubkey>,
        remove: Vec<Pubkey>,
    ) -> Result<()> {
        instructions::hook_allowlist::update_handler(ctx, add, remove)
    }

    pub fn set_default_deny(
        ctx: Context<UpdateHookAllowlist>,
        default_deny: bool,
    ) -> Result<()> {
        instructions::hook_allowlist::set_default_deny_handler(ctx, default_deny)
    }

    pub fn transfer_hook_authority(
        ctx: Context<TransferHookAuthority>,
        new_authority: Pubkey,
    ) -> Result<()> {
        instructions::hook_allowlist::transfer_authority_handler(ctx, new_authority)
    }

    pub fn accept_hook_authority(ctx: Context<AcceptHookAuthority>) -> Result<()> {
        instructions::hook_allowlist::accept_authority_handler(ctx)
    }

    pub fn init_agent_hook_allowlist(
        ctx: Context<InitAgentHookAllowlist>,
        agent_did: [u8; 32],
    ) -> Result<()> {
        instructions::agent_hook_allowlist::init_agent_handler(ctx, agent_did)
    }

    pub fn update_agent_hook_allowlist(
        ctx: Context<UpdateAgentHookAllowlist>,
        add: Vec<Pubkey>,
        remove: Vec<Pubkey>,
    ) -> Result<()> {
        instructions::agent_hook_allowlist::update_agent_handler(ctx, add, remove)
    }

    // ── guard ──────────────────────────────────────────────────

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

    // ── fee distribution ───────────────────────────────────────

    pub fn init_config(
        ctx: Context<InitConfig>,
        params: instructions::init_config::InitConfigParams,
    ) -> Result<()> {
        instructions::init_config::handler(ctx, params)
    }

    pub fn process_epoch(ctx: Context<ProcessEpoch>, snapshot_id: u64) -> Result<()> {
        instructions::process_epoch::handler(ctx, snapshot_id)
    }

    pub fn commit_distribution_root(
        ctx: Context<CommitDistributionRoot>,
        epoch_id: u64,
        root: [u8; 32],
        leaf_count: u32,
        total_weight: u64,
    ) -> Result<()> {
        instructions::commit_distribution::handler(ctx, epoch_id, root, leaf_count, total_weight)
    }

    pub fn claim_staker(
        ctx: Context<ClaimStaker>,
        epoch_id: u64,
        amount: u64,
        merkle_proof: Vec<[u8; 32]>,
    ) -> Result<()> {
        instructions::claim_staker::handler(ctx, epoch_id, amount, merkle_proof)
    }

    pub fn execute_burn(ctx: Context<ExecuteBurn>, epoch_id: u64) -> Result<()> {
        instructions::execute_burn::handler(ctx, epoch_id)
    }

    pub fn sweep_stale_epoch(ctx: Context<SweepStaleEpoch>, epoch_id: u64) -> Result<()> {
        instructions::sweep_stale::handler(ctx, epoch_id)
    }

    pub fn record_slash_receipt(ctx: Context<RecordSlashReceipt>, amount: u64) -> Result<()> {
        instructions::record_intake::slash_handler(ctx, amount)
    }

    pub fn record_collateral_forfeit(
        ctx: Context<RecordCollateralForfeit>,
        amount: u64,
    ) -> Result<()> {
        instructions::record_intake::forfeit_handler(ctx, amount)
    }

    pub fn set_distribution_params(
        ctx: Context<SetDistributionParams>,
        burn_bps: u16,
        staker_share_bps: u16,
        grant_share_bps: u16,
        treasury_share_bps: u16,
    ) -> Result<()> {
        instructions::set_params::set_distribution_handler(
            ctx,
            burn_bps,
            staker_share_bps,
            grant_share_bps,
            treasury_share_bps,
        )
    }

    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        instructions::set_params::set_paused_handler(ctx, paused)
    }
}
