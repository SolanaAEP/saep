use anchor_lang::prelude::*;
use solana_bn254::prelude::{
    alt_bn128_addition,
    alt_bn128_multiplication,
    alt_bn128_pairing,
};

use crate::errors::ProofVerifierError;
use crate::state::{VerifierKey, BN254_BASE_FIELD_MODULUS_BE};

pub(crate) fn g1_add(a: &[u8; 64], b: &[u8; 64]) -> std::result::Result<[u8; 64], ()> {
    let out = alt_bn128_addition(&[a.as_slice(), b.as_slice()].concat()).map_err(|_| ())?;
    out.try_into().map_err(|_| ())
}

pub(crate) fn g1_scalar_mul(
    point: &[u8; 64],
    scalar: &[u8; 32],
) -> std::result::Result<[u8; 64], ()> {
    let out = alt_bn128_multiplication(&[point.as_slice(), scalar.as_slice()].concat())
        .map_err(|_| ())?;
    out.try_into().map_err(|_| ())
}

pub(crate) fn pairing_check(input: &[u8]) -> std::result::Result<bool, ()> {
    let out = alt_bn128_pairing(input).map_err(|_| ())?;
    Ok(out.get(31).copied() == Some(1))
}

pub(crate) fn negate_g1(point: &[u8; 64]) -> [u8; 64] {
    let mut out = [0u8; 64];
    out[..32].copy_from_slice(&point[..32]);

    if point[32..].iter().all(|&b| b == 0) {
        return out;
    }

    let mut borrow: u16 = 0;
    for i in (0..32).rev() {
        // nosemgrep: saep.solana.wrapping-arithmetic — bn254 field-element subtraction; wrap is
        // the defined modular behavior, not silent financial overflow.
        let diff = (BN254_BASE_FIELD_MODULUS_BE[i] as u16)
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
        vk_x = g1_add(&vk_x, &term).map_err(|_| error!(ProofVerifierError::ProofMalformed))?;
    }

    let neg_a = negate_g1(proof_a);

    // Match the pair ordering used by groth16-solana's verified reference path:
    // e(-A, B) * e(vk_x, gamma) * e(C, delta) * e(alpha, beta) == 1
    let mut buf = [0u8; 768];
    let mut o = 0;
    buf[o..o + 64].copy_from_slice(&neg_a);
    o += 64;
    buf[o..o + 128].copy_from_slice(proof_b);
    o += 128;
    buf[o..o + 64].copy_from_slice(&vk_x);
    o += 64;
    buf[o..o + 128].copy_from_slice(&vk.gamma_g2);
    o += 128;
    buf[o..o + 64].copy_from_slice(proof_c);
    o += 64;
    buf[o..o + 128].copy_from_slice(&vk.delta_g2);
    o += 128;
    buf[o..o + 64].copy_from_slice(&vk.alpha_g1);
    o += 64;
    buf[o..o + 128].copy_from_slice(&vk.beta_g2);

    let valid = pairing_check(&buf).map_err(|_| error!(ProofVerifierError::ProofMalformed))?;

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
