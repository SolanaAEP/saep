use anchor_lang::prelude::*;

use crate::errors::ProofVerifierError;
use crate::state::{VerifierKey, BN254_FIELD_MODULUS_BE};

const ALT_BN128_ADD: u64 = 0;
const ALT_BN128_MUL: u64 = 1;
const ALT_BN128_PAIRING: u64 = 2;

#[cfg(target_os = "solana")]
extern "C" {
    fn sol_alt_bn128_group_op(
        group_op: u64,
        input: *const u8,
        input_size: u64,
        result: *mut u8,
    ) -> u64;
}

#[cfg(not(target_os = "solana"))]
unsafe fn sol_alt_bn128_group_op(
    _group_op: u64,
    _input: *const u8,
    _input_size: u64,
    _result: *mut u8,
) -> u64 {
    panic!("alt_bn128 syscall unavailable outside solana runtime")
}

pub(crate) fn g1_add(a: &[u8; 64], b: &[u8; 64]) -> std::result::Result<[u8; 64], ()> {
    let mut buf = [0u8; 128];
    buf[..64].copy_from_slice(a);
    buf[64..].copy_from_slice(b);
    let mut out = [0u8; 64];
    if unsafe { sol_alt_bn128_group_op(ALT_BN128_ADD, buf.as_ptr(), 128, out.as_mut_ptr()) } != 0 {
        return Err(());
    }
    Ok(out)
}

pub(crate) fn g1_scalar_mul(point: &[u8; 64], scalar: &[u8; 32]) -> std::result::Result<[u8; 64], ()> {
    let mut buf = [0u8; 96];
    buf[..64].copy_from_slice(point);
    buf[64..].copy_from_slice(scalar);
    let mut out = [0u8; 64];
    if unsafe { sol_alt_bn128_group_op(ALT_BN128_MUL, buf.as_ptr(), 96, out.as_mut_ptr()) } != 0 {
        return Err(());
    }
    Ok(out)
}

pub(crate) fn pairing_check(input: &[u8]) -> std::result::Result<bool, ()> {
    let mut out = [0u8; 32];
    if unsafe {
        sol_alt_bn128_group_op(ALT_BN128_PAIRING, input.as_ptr(), input.len() as u64, out.as_mut_ptr())
    } != 0
    {
        return Err(());
    }
    Ok(out[31] == 1)
}

pub(crate) fn negate_g1(point: &[u8; 64]) -> [u8; 64] {
    let mut out = [0u8; 64];
    out[..32].copy_from_slice(&point[..32]);

    if point[32..].iter().all(|&b| b == 0) {
        return out;
    }

    let mut borrow: u16 = 0;
    for i in (0..32).rev() {
        let diff = (BN254_FIELD_MODULUS_BE[i] as u16)
            .wrapping_sub(point[32 + i] as u16)
            .wrapping_sub(borrow);
        out[32 + i] = diff as u8;
        borrow = if diff > 0xff { 1 } else { 0 };
    }

    out
}

pub fn verify_groth16(
    vk: &VerifierKey,
    proof_a: &[u8; 64],
    proof_b: &[u8; 128],
    proof_c: &[u8; 64],
    public_inputs: &[[u8; 32]],
) -> Result<()> {
    let mut vk_x = vk.ic[0];
    for (i, input) in public_inputs.iter().enumerate() {
        let term = g1_scalar_mul(&vk.ic[i + 1], input)
            .map_err(|_| error!(ProofVerifierError::ProofMalformed))?;
        vk_x = g1_add(&vk_x, &term)
            .map_err(|_| error!(ProofVerifierError::ProofMalformed))?;
    }

    let neg_a = negate_g1(proof_a);

    // e(-A, B) * e(alpha, beta) * e(vk_x, gamma) * e(C, delta) == 1
    let mut buf = [0u8; 768];
    let mut o = 0;
    buf[o..o + 64].copy_from_slice(&neg_a);       o += 64;
    buf[o..o + 128].copy_from_slice(proof_b);      o += 128;
    buf[o..o + 64].copy_from_slice(&vk.alpha_g1);  o += 64;
    buf[o..o + 128].copy_from_slice(&vk.beta_g2);  o += 128;
    buf[o..o + 64].copy_from_slice(&vk_x);         o += 64;
    buf[o..o + 128].copy_from_slice(&vk.gamma_g2); o += 128;
    buf[o..o + 64].copy_from_slice(proof_c);        o += 64;
    buf[o..o + 128].copy_from_slice(&vk.delta_g2);

    let valid = pairing_check(&buf)
        .map_err(|_| error!(ProofVerifierError::ProofMalformed))?;

    require!(valid, ProofVerifierError::ProofInvalid);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn negate_identity_is_identity() {
        let identity = [0u8; 64];
        assert_eq!(negate_g1(&identity), identity);
    }

    #[test]
    fn negate_is_involutory() {
        let mut point = [0u8; 64];
        point[31] = 1; // x = 1
        point[63] = 2; // y = 2
        let neg = negate_g1(&point);
        let neg_neg = negate_g1(&neg);
        assert_eq!(neg_neg, point);
    }

    #[test]
    fn negate_changes_y_only() {
        let mut point = [0u8; 64];
        point[31] = 1;
        point[63] = 2;
        let neg = negate_g1(&point);
        assert_eq!(&neg[..32], &point[..32]);
        assert_ne!(&neg[32..], &point[32..]);
    }
}
