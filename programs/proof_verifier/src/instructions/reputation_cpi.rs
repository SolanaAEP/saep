use agent_registry::program::AgentRegistry;
use agent_registry::state::ReputationSample;
use anchor_lang::prelude::*;
use light_poseidon::{Poseidon, PoseidonBytesHasher, PoseidonHasher};
use solana_instructions_sysvar::ID as IX_SYSVAR_ID;

use crate::errors::ProofVerifierError;
use crate::events::ReentrancyRejected;
use crate::guard::{
    check_callee_preconditions, load_caller_guard, AllowedCallers, ReentrancyGuard,
    SEED_ALLOWED_CALLERS, SEED_GUARD,
};
use crate::pairing::verify_groth16;
use crate::state::{scalar_in_field, GlobalMode, VerifierConfig, VerifierKey};

pub const REP_AUTHORITY_SEED: &[u8] = b"rep_authority";

/// Expected number of public inputs for the reputation-bound circuit:
/// [task_hash, result_hash, deadline, submitted_at, criteria_root,
///  agent_did, capability_bit, sample_hash, task_id]
const REP_PUBLIC_INPUT_COUNT: usize = 9;

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

/// Compute Poseidon hash of the reputation sample vector, matching the circuit's
/// `Poseidon(6)` over `[quality, timeliness, availability, cost_efficiency, honesty, disputed]`.
/// Returns the hash as a 32-byte big-endian scalar (bn254 Fr).
fn hash_sample(sample: &ReputationSample) -> Result<[u8; 32]> {
    let mut poseidon = Poseidon::<ark_bn254::Fr>::new_circom(6)
        .map_err(|_| ProofVerifierError::PoseidonError)?;

    let inputs: [[u8; 32]; 6] = [
        u16_to_scalar(sample.quality),
        u16_to_scalar(sample.timeliness),
        u16_to_scalar(sample.availability),
        u16_to_scalar(sample.cost_efficiency),
        u16_to_scalar(sample.honesty),
        bool_to_scalar(sample.disputed),
    ];
    let refs: Vec<&[u8]> = inputs.iter().map(|x| x.as_ref()).collect();
    poseidon
        .hash_bytes_be(&refs)
        .map_err(|_| ProofVerifierError::PoseidonError.into())
}

fn u16_to_scalar(v: u16) -> [u8; 32] {
    let mut buf = [0u8; 32];
    buf[30] = (v >> 8) as u8;
    buf[31] = v as u8;
    buf
}

fn bool_to_scalar(v: bool) -> [u8; 32] {
    let mut buf = [0u8; 32];
    if v {
        buf[31] = 1;
    }
    buf
}

#[allow(clippy::too_many_arguments)]
pub fn verify_and_update_reputation_handler(
    ctx: Context<VerifyAndUpdateReputation>,
    proof_a: [u8; 64],
    proof_b: [u8; 128],
    proof_c: [u8; 64],
    public_inputs: Vec<[u8; 32]>,
    _agent_did: [u8; 32],
    _capability_bit: u16,
    sample: ReputationSample,
    _task_id: [u8; 32],
) -> Result<()> {
    // Reentrancy guard
    let ix_ai = &ctx.accounts.instructions.to_account_info();
    let current_index = solana_instructions_sysvar::load_current_index_checked(ix_ai)?;
    let current_ix =
        solana_instructions_sysvar::load_instruction_at_checked(current_index as usize, ix_ai)?;
    let stack_height = anchor_lang::solana_program::instruction::get_stack_height();
    require!(stack_height <= 2, ProofVerifierError::CpiDepthExceeded);
    let caller_program = current_ix.program_id;

    let caller_guard = match load_caller_guard(
        &ctx.accounts.caller_guard.to_account_info(),
        &caller_program,
    ) {
        Ok(g) => g,
        Err(e) => {
            let clock = Clock::get()?;
            emit!(ReentrancyRejected {
                program: crate::ID,
                offending_caller: caller_program,
                slot: clock.slot,
            });
            return Err(e);
        }
    };

    if let Err(e) = check_callee_preconditions(
        &ctx.accounts.self_guard,
        caller_guard.active,
        &caller_program,
        &ctx.accounts.allowed_callers,
        stack_height,
    ) {
        let clock = Clock::get()?;
        emit!(ReentrancyRejected {
            program: crate::ID,
            offending_caller: caller_program,
            slot: clock.slot,
        });
        return Err(e);
    }

    let config = &ctx.accounts.config;
    let vk = &ctx.accounts.vk;
    let mode = &ctx.accounts.mode;

    require!(!config.paused, ProofVerifierError::Paused);
    require_keys_eq!(config.active_vk, vk.key(), ProofVerifierError::VkMismatch);
    require!(
        public_inputs.len() == REP_PUBLIC_INPUT_COUNT,
        ProofVerifierError::PublicInputCountMismatch
    );
    if mode.is_mainnet {
        require!(vk.is_production, ProofVerifierError::NotProductionVk);
    }
    for scalar in &public_inputs {
        require!(
            scalar_in_field(scalar),
            ProofVerifierError::PublicInputOutOfField
        );
    }

    // Verify the Groth16 proof
    verify_groth16(vk, &proof_a, &proof_b, &proof_c, &public_inputs)?;

    // Extract reputation-bound values from verified public inputs.
    // Layout: [task_hash, result_hash, deadline, submitted_at, criteria_root,
    //          agent_did, capability_bit, sample_hash, task_id]
    let agent_did = public_inputs[5];
    let capability_bit_scalar = public_inputs[6];
    let sample_hash_from_proof = public_inputs[7];
    let task_id = public_inputs[8];

    // Decode capability_bit from scalar (big-endian, fits in u16)
    let capability_bit = u16::from_be_bytes([
        capability_bit_scalar[30],
        capability_bit_scalar[31],
    ]);
    // Verify upper bytes are zero (range already checked by circuit, but defense in depth)
    require!(
        capability_bit_scalar[..30].iter().all(|&b| b == 0),
        ProofVerifierError::PublicInputOutOfField
    );

    // Compute sample hash on-chain and verify it matches the proof's commitment
    let computed_hash = hash_sample(&sample)?;
    require!(
        computed_hash == sample_hash_from_proof,
        ProofVerifierError::SampleHashMismatch
    );

    // CPI to agent_registry::update_reputation with proof-verified values
    let rep_bump = ctx.bumps.rep_authority;
    let signer_seeds: &[&[u8]] = &[REP_AUTHORITY_SEED, &[rep_bump]];

    let cpi_accounts = agent_registry::cpi::accounts::UpdateReputation {
        global: ctx.accounts.registry_global.to_account_info(),
        agent: ctx.accounts.registry_agent.to_account_info(),
        category: ctx.accounts.category_reputation.to_account_info(),
        proof_verifier_authority: ctx.accounts.rep_authority.to_account_info(),
        payer: ctx.accounts.payer.to_account_info(),
        self_guard: ctx.accounts.registry_self_guard.to_account_info(),
        allowed_callers: ctx.accounts.registry_allowed_callers.to_account_info(),
        caller_guard: ctx.accounts.self_guard.to_account_info(),
        instructions: ctx.accounts.instructions.to_account_info(),
        system_program: ctx.accounts.system_program.to_account_info(),
    };
    let signer_seeds_arr = [signer_seeds];
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.agent_registry_program.key(),
        cpi_accounts,
        &signer_seeds_arr,
    );

    // proof_key = hash of the proof itself for replay tracking
    let proof_key = solana_keccak_hasher::hash(&proof_a).0;

    agent_registry::cpi::update_reputation(
        cpi_ctx,
        agent_did,
        capability_bit,
        sample,
        task_id,
        proof_key,
    )
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
    fn u16_to_scalar_roundtrip() {
        let val: u16 = 42;
        let s = u16_to_scalar(val);
        assert_eq!(s[30], 0);
        assert_eq!(s[31], 42);
        assert!(s[..30].iter().all(|&b| b == 0));
    }

    #[test]
    fn u16_to_scalar_max() {
        let s = u16_to_scalar(u16::MAX);
        assert_eq!(s[30], 0xFF);
        assert_eq!(s[31], 0xFF);
    }

    #[test]
    fn bool_to_scalar_values() {
        let t = bool_to_scalar(true);
        let f = bool_to_scalar(false);
        assert_eq!(t[31], 1);
        assert_eq!(f[31], 0);
        assert!(t[..31].iter().all(|&b| b == 0));
        assert!(f.iter().all(|&b| b == 0));
    }

    #[test]
    fn hash_sample_deterministic() {
        let sample = ReputationSample {
            quality: 8000,
            timeliness: 7500,
            availability: 9000,
            cost_efficiency: 6000,
            honesty: 8500,
            disputed: false,
        };
        let h1 = hash_sample(&sample).unwrap();
        let h2 = hash_sample(&sample).unwrap();
        assert_eq!(h1, h2);
    }

    #[test]
    fn hash_sample_different_inputs() {
        let s1 = ReputationSample {
            quality: 8000,
            timeliness: 7500,
            availability: 9000,
            cost_efficiency: 6000,
            honesty: 8500,
            disputed: false,
        };
        let s2 = ReputationSample {
            quality: 8001,
            timeliness: 7500,
            availability: 9000,
            cost_efficiency: 6000,
            honesty: 8500,
            disputed: false,
        };
        assert_ne!(hash_sample(&s1).unwrap(), hash_sample(&s2).unwrap());
    }

    #[test]
    fn hash_sample_disputed_differs() {
        let s1 = ReputationSample {
            quality: 5000,
            timeliness: 5000,
            availability: 5000,
            cost_efficiency: 5000,
            honesty: 5000,
            disputed: false,
        };
        let mut s2 = s1.clone();
        s2.disputed = true;
        assert_ne!(hash_sample(&s1).unwrap(), hash_sample(&s2).unwrap());
    }
}
