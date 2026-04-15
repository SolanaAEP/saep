use anchor_lang::prelude::*;

use crate::errors::ProofVerifierError;
use crate::pairing::verify_groth16;
use crate::state::{scalar_in_field, GlobalMode, VerifierConfig, VerifierKey};

#[derive(Accounts)]
pub struct VerifyProof<'info> {
    #[account(seeds = [b"verifier_config"], bump = config.bump)]
    pub config: Account<'info, VerifierConfig>,

    #[account(
        seeds = [b"vk", vk.vk_id.as_ref()],
        bump = vk.bump,
    )]
    pub vk: Account<'info, VerifierKey>,

    #[account(seeds = [b"mode"], bump = mode.bump)]
    pub mode: Account<'info, GlobalMode>,
}

pub fn handler(
    ctx: Context<VerifyProof>,
    proof_a: [u8; 64],
    proof_b: [u8; 128],
    proof_c: [u8; 64],
    public_inputs: Vec<[u8; 32]>,
) -> Result<()> {
    let config = &ctx.accounts.config;
    let vk = &ctx.accounts.vk;
    let mode = &ctx.accounts.mode;

    require!(!config.paused, ProofVerifierError::Paused);
    require_keys_eq!(config.active_vk, vk.key(), ProofVerifierError::VkMismatch);
    require!(
        public_inputs.len() == vk.num_public_inputs as usize,
        ProofVerifierError::PublicInputCountMismatch
    );
    if mode.is_mainnet {
        require!(vk.is_production, ProofVerifierError::NotProductionVk);
    }
    for scalar in &public_inputs {
        require!(scalar_in_field(scalar), ProofVerifierError::PublicInputOutOfField);
    }

    verify_groth16(vk, &proof_a, &proof_b, &proof_c, &public_inputs)
}

#[derive(Accounts)]
pub struct BatchVerifyStub<'info> {
    pub cranker: Signer<'info>,
}

pub fn batch_verify_stub_handler(_ctx: Context<BatchVerifyStub>) -> Result<()> {
    err!(ProofVerifierError::NotImplemented)
}
