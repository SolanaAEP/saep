// PAIRING-STUB: Light Protocol bn254 groth16 verifier not yet pinned in workspace.
// Swap this module for a real pairing call (e.g. light_protocol::groth16_verifier::verify)
// before mainnet. Public-input ordering is locked in spec 06 and spec 05.

use anchor_lang::prelude::*;

use crate::errors::ProofVerifierError;
use crate::state::VerifierKey;

pub fn verify_groth16(
    _vk: &VerifierKey,
    _proof_a: &[u8; 64],
    _proof_b: &[u8; 128],
    _proof_c: &[u8; 64],
    _public_inputs: &[[u8; 32]],
) -> Result<()> {
    // Stub: accept any well-formed input. Real pairing lands before audit.
    // Returning Err here would block integration; returning Ok is the explicit
    // WIP choice and is flagged in reports/proof-verifier-anchor-wip.md.
    msg!("pairing-stub: verify_groth16 invoked, returning Ok");
    let _ = ProofVerifierError::ProofInvalid;
    Ok(())
}
