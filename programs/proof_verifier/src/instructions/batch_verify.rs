use anchor_lang::prelude::*;
use solana_keccak_hasher::hashv;

use crate::errors::ProofVerifierError;
use crate::events::BatchVerified;
use crate::pairing::{g1_add, g1_scalar_mul, negate_g1, pairing_check};
use crate::state::{
    scalar_in_field, BatchState, GlobalMode, VerifierConfig, VerifierKey, MAX_BATCH_SIZE,
};

fn derive_scalar(state: &[u8; 32], index: u8) -> [u8; 32] {
    if index == 0 {
        let mut one = [0u8; 32];
        one[31] = 1;
        return one;
    }
    let h = hashv(&[state.as_ref(), &[index]]);
    let mut s = h.to_bytes();
    s[..16].fill(0);
    s
}

#[derive(Accounts)]
#[instruction(batch_id: [u8; 16])]
pub struct OpenBatch<'info> {
    #[account(mut)]
    pub cranker: Signer<'info>,

    #[account(
        init,
        payer = cranker,
        space = 8 + BatchState::INIT_SPACE,
        seeds = [b"batch", cranker.key().as_ref(), &batch_id],
        bump,
    )]
    pub batch: Box<Account<'info, BatchState>>,

    #[account(seeds = [b"verifier_config"], bump = config.bump)]
    pub config: Box<Account<'info, VerifierConfig>>,

    pub system_program: Program<'info, System>,
}

pub fn open_batch_handler(
    ctx: Context<OpenBatch>,
    batch_id: [u8; 16],
    max_proofs: u8,
) -> Result<()> {
    let config = &ctx.accounts.config;
    require!(!config.paused, ProofVerifierError::Paused);
    require!(
        max_proofs >= 1 && (max_proofs as usize) <= MAX_BATCH_SIZE,
        ProofVerifierError::InvalidBatchSize
    );

    let clock = Clock::get()?;
    let batch = &mut ctx.accounts.batch;
    batch.cranker = ctx.accounts.cranker.key();
    batch.vk_key = config.active_vk;
    batch.batch_id = batch_id;
    batch.count = 0;
    batch.max_proofs = max_proofs;
    batch.acc_alpha = [0u8; 64];
    batch.acc_vk_x = [0u8; 64];
    batch.acc_c = [0u8; 64];
    batch.random_state = hashv(&[
        batch_id.as_ref(),
        ctx.accounts.cranker.key().as_ref(),
        &clock.slot.to_le_bytes(),
    ])
    .to_bytes();
    batch.bump = ctx.bumps.batch;

    Ok(())
}

#[derive(Accounts)]
pub struct AddBatchProof<'info> {
    pub cranker: Signer<'info>,

    #[account(
        mut,
        seeds = [b"batch", cranker.key().as_ref(), &batch.batch_id],
        bump = batch.bump,
        has_one = cranker,
    )]
    pub batch: Box<Account<'info, BatchState>>,

    #[account(seeds = [b"verifier_config"], bump = config.bump)]
    pub config: Box<Account<'info, VerifierConfig>>,

    #[account(seeds = [b"vk", vk.vk_id.as_ref()], bump = vk.bump)]
    pub vk: Box<Account<'info, VerifierKey>>,

    #[account(seeds = [b"mode"], bump = mode.bump)]
    pub mode: Box<Account<'info, GlobalMode>>,
}

pub fn add_batch_proof_handler(
    ctx: Context<AddBatchProof>,
    proof_a: [u8; 64],
    proof_b: [u8; 128],
    proof_c: [u8; 64],
    public_inputs: Vec<[u8; 32]>,
) -> Result<()> {
    let config = &ctx.accounts.config;
    let vk = &ctx.accounts.vk;
    let mode = &ctx.accounts.mode;
    let batch = &mut ctx.accounts.batch;

    require!(!config.paused, ProofVerifierError::Paused);
    require!(batch.count < batch.max_proofs, ProofVerifierError::BatchFull);
    require_keys_eq!(batch.vk_key, vk.key(), ProofVerifierError::BatchVkMismatch);
    require_keys_eq!(config.active_vk, vk.key(), ProofVerifierError::VkMismatch);
    if mode.is_mainnet {
        require!(vk.is_production, ProofVerifierError::NotProductionVk);
    }
    require!(
        public_inputs.len() == vk.num_public_inputs as usize,
        ProofVerifierError::PublicInputCountMismatch
    );
    for scalar in &public_inputs {
        require!(
            scalar_in_field(scalar),
            ProofVerifierError::PublicInputOutOfField
        );
    }

    let r = derive_scalar(&batch.random_state, batch.count);

    let mut vk_x = vk.ic[0];
    for (i, input) in public_inputs.iter().enumerate() {
        let term = g1_scalar_mul(&vk.ic[i + 1], input)
            .map_err(|_| error!(ProofVerifierError::ProofMalformed))?;
        vk_x =
            g1_add(&vk_x, &term).map_err(|_| error!(ProofVerifierError::ProofMalformed))?;
    }

    let neg_a = negate_g1(&proof_a);
    let scaled_neg_a = g1_scalar_mul(&neg_a, &r)
        .map_err(|_| error!(ProofVerifierError::ProofMalformed))?;
    let scaled_vk_x = g1_scalar_mul(&vk_x, &r)
        .map_err(|_| error!(ProofVerifierError::ProofMalformed))?;
    let scaled_c = g1_scalar_mul(&proof_c, &r)
        .map_err(|_| error!(ProofVerifierError::ProofMalformed))?;
    let scaled_alpha = g1_scalar_mul(&vk.alpha_g1, &r)
        .map_err(|_| error!(ProofVerifierError::ProofMalformed))?;

    if batch.count == 0 {
        batch.acc_alpha = scaled_alpha;
        batch.acc_vk_x = scaled_vk_x;
        batch.acc_c = scaled_c;
    } else {
        batch.acc_alpha = g1_add(&batch.acc_alpha, &scaled_alpha)
            .map_err(|_| error!(ProofVerifierError::ProofMalformed))?;
        batch.acc_vk_x = g1_add(&batch.acc_vk_x, &scaled_vk_x)
            .map_err(|_| error!(ProofVerifierError::ProofMalformed))?;
        batch.acc_c = g1_add(&batch.acc_c, &scaled_c)
            .map_err(|_| error!(ProofVerifierError::ProofMalformed))?;
    }

    batch.neg_a_scaled.push(scaled_neg_a);
    batch.b_points.push(proof_b);

    batch.random_state =
        hashv(&[batch.random_state.as_ref(), proof_a.as_ref(), proof_b.as_ref(), proof_c.as_ref()])
            .to_bytes();
    batch.count += 1;

    Ok(())
}

#[derive(Accounts)]
pub struct FinalizeBatch<'info> {
    #[account(mut)]
    pub cranker: Signer<'info>,

    #[account(
        mut,
        seeds = [b"batch", cranker.key().as_ref(), &batch.batch_id],
        bump = batch.bump,
        has_one = cranker,
        close = cranker,
    )]
    pub batch: Box<Account<'info, BatchState>>,

    #[account(seeds = [b"verifier_config"], bump = config.bump)]
    pub config: Box<Account<'info, VerifierConfig>>,

    #[account(seeds = [b"vk", vk.vk_id.as_ref()], bump = vk.bump)]
    pub vk: Box<Account<'info, VerifierKey>>,
}

pub fn finalize_batch_handler(ctx: Context<FinalizeBatch>) -> Result<()> {
    let batch = &ctx.accounts.batch;
    let vk = &ctx.accounts.vk;
    let config = &ctx.accounts.config;

    require!(!config.paused, ProofVerifierError::Paused);
    require!(batch.count > 0, ProofVerifierError::BatchEmpty);
    require_keys_eq!(batch.vk_key, vk.key(), ProofVerifierError::BatchVkMismatch);
    require_keys_eq!(config.active_vk, vk.key(), ProofVerifierError::VkMismatch);

    let n = batch.count as usize;
    let total_pairs = n + 3;
    let mut buf = vec![0u8; total_pairs * 192];
    let mut o = 0;

    for i in 0..n {
        buf[o..o + 64].copy_from_slice(&batch.neg_a_scaled[i]);
        o += 64;
        buf[o..o + 128].copy_from_slice(&batch.b_points[i]);
        o += 128;
    }

    buf[o..o + 64].copy_from_slice(&batch.acc_alpha);
    o += 64;
    buf[o..o + 128].copy_from_slice(&vk.beta_g2);
    o += 128;
    buf[o..o + 64].copy_from_slice(&batch.acc_vk_x);
    o += 64;
    buf[o..o + 128].copy_from_slice(&vk.gamma_g2);
    o += 128;
    buf[o..o + 64].copy_from_slice(&batch.acc_c);
    o += 64;
    buf[o..o + 128].copy_from_slice(&vk.delta_g2);

    let valid =
        pairing_check(&buf).map_err(|_| error!(ProofVerifierError::ProofMalformed))?;
    require!(valid, ProofVerifierError::ProofInvalid);

    emit!(BatchVerified {
        batch_id: batch.batch_id,
        count: batch.count,
        vk_id: vk.vk_id,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct AbortBatch<'info> {
    #[account(mut)]
    pub cranker: Signer<'info>,

    #[account(
        mut,
        seeds = [b"batch", cranker.key().as_ref(), &batch.batch_id],
        bump = batch.bump,
        has_one = cranker,
        close = cranker,
    )]
    pub batch: Box<Account<'info, BatchState>>,
}

pub fn abort_batch_handler(_ctx: Context<AbortBatch>) -> Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derive_scalar_index_zero_is_one() {
        let state = [0u8; 32];
        let s = derive_scalar(&state, 0);
        let mut expected = [0u8; 32];
        expected[31] = 1;
        assert_eq!(s, expected);
    }

    #[test]
    fn derive_scalar_upper_bytes_zeroed() {
        let state = [0xffu8; 32];
        let s = derive_scalar(&state, 1);
        assert!(s[..16].iter().all(|&b| b == 0));
    }

    #[test]
    fn derive_scalar_deterministic() {
        let state = [42u8; 32];
        assert_eq!(derive_scalar(&state, 5), derive_scalar(&state, 5));
    }

    #[test]
    fn derive_scalar_different_indices() {
        let state = [42u8; 32];
        assert_ne!(derive_scalar(&state, 1), derive_scalar(&state, 2));
    }
}
