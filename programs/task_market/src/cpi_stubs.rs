use anchor_lang::prelude::*;

// PROOF-VERIFIER-CPI-STUB — M2 wires this to ProofVerifier::verify_proof with
// public inputs in the locked order per spec 06:
//   [task_hash, result_hash, deadline, submitted_at, criteria_root]
pub fn call_proof_verifier(
    _proof_verifier: &Pubkey,
    _task_hash: [u8; 32],
    _result_hash: [u8; 32],
    _deadline: i64,
    _submitted_at: i64,
    _criteria_root: [u8; 32],
    _proof_a: [u8; 64],
    _proof_b: [u8; 128],
    _proof_c: [u8; 64],
) -> Result<()> {
    Ok(())
}

#[derive(Clone, Copy, Debug)]
pub struct JobOutcome {
    pub success: bool,
    pub disputed: bool,
}

// AGENT-REGISTRY-CPI-STUB — M2 wires this to AgentRegistry::record_job_outcome.
// Must be called exactly once per task lifetime (on `release` or `expire`).
pub fn call_record_job_outcome(
    _agent_registry: &Pubkey,
    _agent_did: &[u8; 32],
    _outcome: JobOutcome,
) -> Result<()> {
    Ok(())
}
