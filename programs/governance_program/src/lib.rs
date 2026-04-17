use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

#[cfg(test)]
mod fuzz;

use instructions::*;
use state::*;

declare_id!("9uczLDZaN9EWqW76be75ji4vCsz3cydefbChqvBS6qw1");

#[program]
pub mod governance_program {
    use super::*;

    pub fn init_config(
        ctx: Context<InitConfig>,
        params: instructions::init_config::InitConfigParams,
    ) -> Result<()> {
        instructions::init_config::handler(ctx, params)
    }

    pub fn register_program(
        ctx: Context<RegisterProgram>,
        label: [u8; 16],
        program_id: Pubkey,
        is_critical: bool,
        param_authority_seed: [u8; 32],
        max_param_payload_bytes: u16,
    ) -> Result<()> {
        instructions::register_program::handler(
            ctx,
            label,
            program_id,
            is_critical,
            param_authority_seed,
            max_param_payload_bytes,
        )
    }

    pub fn propose(
        ctx: Context<Propose>,
        category: ProposalCategory,
        target_program: Pubkey,
        ix_data: Vec<u8>,
        metadata_uri: Vec<u8>,
        snapshot: ProposalSnapshot,
    ) -> Result<()> {
        instructions::propose::handler(ctx, category, target_program, ix_data, metadata_uri, snapshot)
    }

    pub fn vote(
        ctx: Context<CastVote>,
        choice: VoteChoice,
        weight: u128,
        merkle_proof: Vec<[u8; 32]>,
    ) -> Result<()> {
        instructions::vote::handler(ctx, choice, weight, merkle_proof)
    }

    pub fn finalize_vote(ctx: Context<FinalizeVote>) -> Result<()> {
        instructions::finalize::handler(ctx)
    }

    pub fn queue_execution(ctx: Context<QueueExecution>) -> Result<()> {
        instructions::execute::queue_handler(ctx)
    }

    pub fn execute_proposal(ctx: Context<ExecuteProposal>) -> Result<()> {
        instructions::execute::execute_handler(ctx)
    }

    pub fn proposer_cancel(ctx: Context<ProposerCancel>) -> Result<()> {
        instructions::cancel_expire::cancel_handler(ctx)
    }

    pub fn expire_proposal(ctx: Context<ExpireProposal>) -> Result<()> {
        instructions::cancel_expire::expire_handler(ctx)
    }

    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        instructions::cancel_expire::set_paused_handler(ctx, paused)
    }
}
