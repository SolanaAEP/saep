use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

use instructions::*;
use state::{AgentStatus, MANIFEST_URI_LEN};

declare_id!("EQJ4Lp2gxJDD5hs185aDcermYWdAi4cQeSKfnuqLAQYu");

#[program]
pub mod agent_registry {
    use super::*;

    #[allow(clippy::too_many_arguments)]
    pub fn init_global(
        ctx: Context<InitGlobal>,
        authority: Pubkey,
        capability_registry: Pubkey,
        task_market: Pubkey,
        dispute_arbitration: Pubkey,
        slashing_treasury: Pubkey,
        stake_mint: Pubkey,
        min_stake: u64,
        max_slash_bps: u16,
        slash_timelock_secs: i64,
    ) -> Result<()> {
        instructions::init_global::handler(
            ctx,
            authority,
            capability_registry,
            task_market,
            dispute_arbitration,
            slashing_treasury,
            stake_mint,
            min_stake,
            max_slash_bps,
            slash_timelock_secs,
        )
    }

    pub fn register_agent(
        ctx: Context<RegisterAgent>,
        agent_id: [u8; 32],
        manifest_uri: [u8; MANIFEST_URI_LEN],
        capability_mask: u128,
        price_lamports: u64,
        stream_rate: u64,
        stake_amount: u64,
    ) -> Result<()> {
        instructions::register_agent::handler(
            ctx,
            agent_id,
            manifest_uri,
            capability_mask,
            price_lamports,
            stream_rate,
            stake_amount,
        )
    }

    pub fn update_manifest(
        ctx: Context<UpdateManifest>,
        manifest_uri: [u8; MANIFEST_URI_LEN],
        capability_mask: u128,
        price_lamports: u64,
        stream_rate: u64,
    ) -> Result<()> {
        instructions::update_manifest::handler(
            ctx,
            manifest_uri,
            capability_mask,
            price_lamports,
            stream_rate,
        )
    }

    pub fn delegate_control(
        ctx: Context<DelegateControl>,
        delegate: Option<Pubkey>,
    ) -> Result<()> {
        instructions::lifecycle::delegate_control_handler(ctx, delegate)
    }

    pub fn set_status(ctx: Context<SetStatus>, new_status: AgentStatus) -> Result<()> {
        instructions::lifecycle::set_status_handler(ctx, new_status)
    }

    pub fn record_job_outcome(
        ctx: Context<RecordJobOutcome>,
        outcome: JobOutcome,
    ) -> Result<()> {
        instructions::lifecycle::record_job_outcome_handler(ctx, outcome)
    }

    pub fn stake_increase(ctx: Context<StakeIncrease>, amount: u64) -> Result<()> {
        instructions::stake::stake_increase_handler(ctx, amount)
    }

    pub fn stake_withdraw_request(
        ctx: Context<StakeWithdrawRequest>,
        amount: u64,
    ) -> Result<()> {
        instructions::stake::stake_withdraw_request_handler(ctx, amount)
    }

    pub fn stake_withdraw_execute(ctx: Context<StakeWithdrawExecute>) -> Result<()> {
        instructions::stake::stake_withdraw_execute_handler(ctx)
    }

    pub fn propose_slash(
        ctx: Context<ProposeSlash>,
        amount: u64,
        reason_code: u16,
    ) -> Result<()> {
        instructions::slash::propose_slash_handler(ctx, amount, reason_code)
    }

    pub fn cancel_slash(ctx: Context<CancelSlash>) -> Result<()> {
        instructions::slash::cancel_slash_handler(ctx)
    }

    pub fn execute_slash(ctx: Context<ExecuteSlash>) -> Result<()> {
        instructions::slash::execute_slash_handler(ctx)
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

    pub fn set_min_stake(ctx: Context<GovernanceUpdate>, new_min_stake: u64) -> Result<()> {
        instructions::governance::set_min_stake_handler(ctx, new_min_stake)
    }

    pub fn set_max_slash_bps(
        ctx: Context<GovernanceUpdate>,
        new_max_slash_bps: u16,
    ) -> Result<()> {
        instructions::governance::set_max_slash_bps_handler(ctx, new_max_slash_bps)
    }

    pub fn set_slash_timelock(
        ctx: Context<GovernanceUpdate>,
        new_timelock_secs: i64,
    ) -> Result<()> {
        instructions::governance::set_slash_timelock_handler(ctx, new_timelock_secs)
    }

    pub fn set_paused(ctx: Context<GovernanceUpdate>, paused: bool) -> Result<()> {
        instructions::governance::set_paused_handler(ctx, paused)
    }
}
