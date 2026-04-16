use agent_registry::program::AgentRegistry;
use agent_registry::state::ReputationSample;
use anchor_lang::prelude::*;
use solana_instructions_sysvar::ID as IX_SYSVAR_ID;

use crate::errors::ProofVerifierError;
use crate::guard::{AllowedCallers, ReentrancyGuard, SEED_ALLOWED_CALLERS, SEED_GUARD};
use crate::state::{GlobalMode, VerifierConfig, VerifierKey};

pub const REP_AUTHORITY_SEED: &[u8] = b"rep_authority";

#[derive(Accounts)]
pub struct VerifyAndUpdateReputation<'info> {
    #[account(seeds = [b"verifier_config"], bump = config.bump)]
    pub config: Account<'info, VerifierConfig>,

    #[account(
        seeds = [b"vk", vk.vk_id.as_ref()],
        bump = vk.bump,
    )]
    pub vk: Account<'info, VerifierKey>,

    #[account(seeds = [b"mode"], bump = mode.bump)]
    pub mode: Account<'info, GlobalMode>,

    /// CHECK: PDA signer seeded `[b"rep_authority"]` within this program.
    /// Only passed through to agent_registry as the CPI signer; ownership of
    /// the derivation is the security guarantee.
    #[account(
        seeds = [REP_AUTHORITY_SEED],
        bump,
    )]
    pub rep_authority: UncheckedAccount<'info>,

    /// CHECK: validated by agent_registry against global + seeds.
    #[account(mut)]
    pub registry_global: UncheckedAccount<'info>,

    /// CHECK: validated by agent_registry against agent PDA + did match.
    pub registry_agent: UncheckedAccount<'info>,

    /// CHECK: validated by agent_registry as the CategoryReputation PDA.
    #[account(mut)]
    pub category_reputation: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(seeds = [SEED_GUARD], bump = self_guard.bump)]
    pub self_guard: Box<Account<'info, ReentrancyGuard>>,

    #[account(seeds = [SEED_ALLOWED_CALLERS], bump = allowed_callers.bump)]
    pub allowed_callers: Box<Account<'info, AllowedCallers>>,

    pub caller_guard: Box<Account<'info, ReentrancyGuard>>,

    /// CHECK: Solana instructions sysvar (address check enforced by Anchor).
    #[account(address = IX_SYSVAR_ID)]
    pub instructions: UncheckedAccount<'info>,

    /// agent_registry's self_guard PDA, for the downstream update_reputation CPI.
    /// CHECK: passed through to agent_registry which verifies seeds + ownership.
    pub registry_self_guard: UncheckedAccount<'info>,

    /// agent_registry's allowed_callers PDA, for the downstream update_reputation CPI.
    /// CHECK: passed through to agent_registry which verifies seeds + ownership.
    pub registry_allowed_callers: UncheckedAccount<'info>,

    pub agent_registry_program: Program<'info, AgentRegistry>,
    pub system_program: Program<'info, System>,
}

#[allow(clippy::too_many_arguments)]
pub fn verify_and_update_reputation_handler(
    _ctx: Context<VerifyAndUpdateReputation>,
    _proof_a: [u8; 64],
    _proof_b: [u8; 128],
    _proof_c: [u8; 64],
    _public_inputs: Vec<[u8; 32]>,
    _agent_did: [u8; 32],
    _capability_bit: u16,
    _sample: ReputationSample,
    _task_id: [u8; 32],
) -> Result<()> {
    // F-2026-02: the current signature accepts caller-controlled
    // `(agent_did, capability_bit, sample, task_id)` alongside a Groth16
    // proof whose public inputs do not bind those args. Any caller holding
    // any valid proof could write an arbitrary sample against any agent.
    //
    // The full fix requires reworking the Circom circuit to commit
    // `(agent_did, capability_bit, sample_hash, task_id)` as public outputs,
    // re-deriving the trusted-setup VK, and rebinding the handler to read
    // those fields from `public_inputs[..]` rather than from untrusted args.
    // That is out of scope for this audit-hardening pass and tracked in
    // `reports/autonomous-blockers.md`.
    //
    // Interim: refuse to run. The release rail no longer CPIs here (see
    // F-2026-03), so until the circuit rebinding lands there is no
    // legitimate caller of this ix.
    err!(ProofVerifierError::ReputationBindingNotReady)
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::solana_program::pubkey::Pubkey as Pk;

    #[test]
    fn rep_authority_seed_constant() {
        assert_eq!(REP_AUTHORITY_SEED, b"rep_authority");
    }

    #[test]
    fn rep_authority_pda_deterministic() {
        let program_id = Pk::new_unique();
        let (a, _) = Pk::find_program_address(&[REP_AUTHORITY_SEED], &program_id);
        let (b, _) = Pk::find_program_address(&[REP_AUTHORITY_SEED], &program_id);
        assert_eq!(a, b);
    }

    #[test]
    fn rep_authority_pda_program_scoped() {
        let p1 = Pk::new_unique();
        let p2 = Pk::new_unique();
        let (a, _) = Pk::find_program_address(&[REP_AUTHORITY_SEED], &p1);
        let (b, _) = Pk::find_program_address(&[REP_AUTHORITY_SEED], &p2);
        assert_ne!(a, b);
    }

    #[test]
    fn reputation_binding_not_ready_error_exists() {
        // F-2026-02 regression: the interim fail-close error must remain in
        // the error enum until the circuit rebinding lands. Constructing it
        // through `err!` is not possible in a pure unit test harness (no
        // program id), but we can verify the variant is present by pattern
        // match on a produced `Error`.
        let e: anchor_lang::error::Error =
            ProofVerifierError::ReputationBindingNotReady.into();
        let rendered = format!("{:?}", e);
        assert!(
            rendered.contains("ReputationBindingNotReady"),
            "expected ReputationBindingNotReady in error, got: {}",
            rendered
        );
    }
}
