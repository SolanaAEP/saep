use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod guard;
pub mod hook;
pub mod instructions;
pub mod state;

pub use errors::FeeCollectorError;
pub use hook::{
    assert_hook_allowed, assert_hook_allowed_at_site, get_transfer_hook_program_id,
    inspect_mint_extensions, MintExtensionReport,
};
pub use state::{
    AgentHookAllowlist, HookAllowlist, MAX_AGENT_HOOK_PROGRAMS, MAX_HOOK_PROGRAMS,
    MINT_FLAG_ALL, MINT_FLAG_HOOK_OK, MINT_FLAG_NO_FROZEN_DEFAULT,
    MINT_FLAG_NO_PERMANENT_DELEGATE, MINT_FLAG_NO_TRANSFER_FEE, SEED_AGENT_HOOKS,
    SEED_HOOK_ALLOWLIST, SITE_CLAIM_BOND_REFUND, SITE_CLAIM_BOND_SLASH,
    SITE_COMMIT_BID_BOND, SITE_EXPIRE, SITE_FUND_TASK, SITE_FUND_TREASURY,
    SITE_INIT_STREAM, SITE_RELEASE, SITE_STREAM_CLOSE, SITE_STREAM_SWAP,
    SITE_STREAM_WITHDRAW, SITE_WITHDRAW,
};

use instructions::*;

declare_id!("4xLpFgjpZwJbf61UyvyMhmEBmeJzPaCyKvZeYuK2YFFu");

#[program]
pub mod fee_collector {
    use super::*;

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
