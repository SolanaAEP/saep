use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod instructions;
pub mod pairing;
pub mod state;

use instructions::*;

declare_id!("DcJx1p6bcNuFm4i5WMgK4uGZitc1bf4Ubc5d4sctZKVe");

#[program]
pub mod proof_verifier {
    use super::*;

    pub fn init_config(
        ctx: Context<InitConfig>,
        authority: Pubkey,
        is_mainnet: bool,
    ) -> Result<()> {
        instructions::init_config::handler(ctx, authority, is_mainnet)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn register_vk(
        ctx: Context<RegisterVk>,
        vk_id: [u8; 32],
        alpha_g1: [u8; 64],
        beta_g2: [u8; 128],
        gamma_g2: [u8; 128],
        delta_g2: [u8; 128],
        ic: Vec<[u8; 64]>,
        num_public_inputs: u8,
        circuit_label: [u8; 32],
        is_production: bool,
    ) -> Result<()> {
        instructions::register_vk::handler(
            ctx,
            vk_id,
            alpha_g1,
            beta_g2,
            gamma_g2,
            delta_g2,
            ic,
            num_public_inputs,
            circuit_label,
            is_production,
        )
    }

    pub fn propose_vk_activation(ctx: Context<ProposeVkActivation>) -> Result<()> {
        instructions::vk_activation::propose_handler(ctx)
    }

    pub fn execute_vk_activation(ctx: Context<ExecuteVkActivation>) -> Result<()> {
        instructions::vk_activation::execute_handler(ctx)
    }

    pub fn cancel_vk_activation(ctx: Context<CancelVkActivation>) -> Result<()> {
        instructions::vk_activation::cancel_handler(ctx)
    }

    pub fn verify_proof(
        ctx: Context<VerifyProof>,
        proof_a: [u8; 64],
        proof_b: [u8; 128],
        proof_c: [u8; 64],
        public_inputs: Vec<[u8; 32]>,
    ) -> Result<()> {
        instructions::verify_proof::handler(ctx, proof_a, proof_b, proof_c, public_inputs)
    }

    pub fn open_batch(
        ctx: Context<OpenBatch>,
        batch_id: [u8; 16],
        max_proofs: u8,
    ) -> Result<()> {
        instructions::batch_verify::open_batch_handler(ctx, batch_id, max_proofs)
    }

    pub fn add_batch_proof(
        ctx: Context<AddBatchProof>,
        proof_a: [u8; 64],
        proof_b: [u8; 128],
        proof_c: [u8; 64],
        public_inputs: Vec<[u8; 32]>,
    ) -> Result<()> {
        instructions::batch_verify::add_batch_proof_handler(
            ctx,
            proof_a,
            proof_b,
            proof_c,
            public_inputs,
        )
    }

    pub fn finalize_batch(ctx: Context<FinalizeBatch>) -> Result<()> {
        instructions::batch_verify::finalize_batch_handler(ctx)
    }

    pub fn abort_batch(ctx: Context<AbortBatch>) -> Result<()> {
        instructions::batch_verify::abort_batch_handler(ctx)
    }

    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        instructions::set_paused::handler(ctx, paused)
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
}
