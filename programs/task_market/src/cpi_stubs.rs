use anchor_lang::prelude::*;

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
