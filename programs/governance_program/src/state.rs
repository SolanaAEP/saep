use anchor_lang::prelude::*;

pub const SEED_GOV_CONFIG: &[u8] = b"governance_config";
pub const SEED_PROGRAM_REGISTRY: &[u8] = b"program_registry";
pub const SEED_PROPOSAL: &[u8] = b"proposal";
pub const SEED_VOTE: &[u8] = b"vote";
pub const SEED_EXECUTION: &[u8] = b"execution";
pub const SEED_COLLATERAL_ESCROW: &[u8] = b"collateral_escrow";

pub const MAX_REGISTERED_PROGRAMS: usize = 32;
pub const MAX_METADATA_URI: usize = 128;
pub const MAX_IX_DATA: usize = 512;
pub const MAX_MEMO: usize = 64;
pub const MAX_MERKLE_PROOF_DEPTH: usize = 24;
pub const MAX_SLUG_LEN: usize = 32;
pub const MAX_MANIFEST_URI: usize = 128;

pub const EXECUTION_WINDOW_SECS: i64 = 14 * 86_400;

// ── enums ──────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum ProposalCategory {
    ParameterChange,
    ProgramUpgrade,
    TreasurySpend,
    EmergencyPause,
    CapabilityTagUpdate,
    Meta,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum ProposalStatus {
    Voting,
    Passed,
    Rejected,
    Queued,
    Executed,
    Failed,
    Cancelled,
    Expired,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum VoteChoice {
    For,
    Against,
    Abstain,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum ExecutionResult {
    Ok,
    CpiFailed { code: u32 },
    TargetMissing,
    PayloadInvalid,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum EmergencyKind {
    Pause,
    Unpause,
}

// ── state accounts ─────────────────────────────────────────────

#[account]
#[derive(InitSpace)]
pub struct GovernanceConfig {
    pub authority: Pubkey,
    pub nxs_staking: Pubkey,
    pub capability_registry: Pubkey,
    pub fee_collector: Pubkey,
    pub emergency_council: Pubkey,
    pub min_proposer_stake: u64,
    pub proposer_collateral: u64,
    pub vote_window_secs_standard: i64,
    pub vote_window_secs_emergency: i64,
    pub vote_window_secs_meta: i64,
    pub quorum_bps: u16,
    pub pass_threshold_bps: u16,
    pub meta_pass_threshold_bps: u16,
    pub timelock_secs_standard: i64,
    pub timelock_secs_critical: i64,
    pub timelock_secs_meta: i64,
    pub min_lock_to_vote_secs: i64,
    pub dev_mode_timelock_override_secs: i64,
    pub next_proposal_id: u64,
    pub next_emergency_id: u64,
    pub paused: bool,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, InitSpace)]
pub struct RegisteredProgram {
    pub program_id: Pubkey,
    pub label: [u8; 16],
    pub is_critical: bool,
    pub param_authority_seed: [u8; 32],
    pub max_param_payload_bytes: u16,
}

#[account]
#[derive(InitSpace)]
pub struct ProgramRegistry {
    #[max_len(MAX_REGISTERED_PROGRAMS)]
    pub entries: Vec<RegisteredProgram>,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, InitSpace)]
pub struct ProposalSnapshot {
    pub total_eligible_weight: u128,
    pub snapshot_slot: u64,
    pub snapshot_root: [u8; 32],
}

#[account]
#[derive(InitSpace)]
pub struct ProposalAccount {
    pub proposal_id: u64,
    pub proposer: Pubkey,
    pub category: ProposalCategory,
    pub target_program: Pubkey,
    #[max_len(MAX_IX_DATA)]
    pub ix_data: Vec<u8>,
    #[max_len(MAX_METADATA_URI)]
    pub metadata_uri: Vec<u8>,
    pub snapshot: ProposalSnapshot,
    pub status: ProposalStatus,
    pub created_at: i64,
    pub vote_start: i64,
    pub vote_end: i64,
    pub tallied_at: i64,
    pub executable_at: i64,
    pub executed_at: i64,
    pub for_weight: u128,
    pub against_weight: u128,
    pub abstain_weight: u128,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct VoteRecord {
    pub proposal_id: u64,
    pub voter: Pubkey,
    pub choice: VoteChoice,
    pub weight: u128,
    pub cast_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct ExecutionRecord {
    pub proposal_id: u64,
    pub executed_at: i64,
    pub result: ExecutionResult,
    pub cpi_target: Pubkey,
    pub cpi_payload_hash: [u8; 32],
    pub bump: u8,
}

// ── helpers ────────────────────────────────────────────────────

impl GovernanceConfig {
    pub fn vote_window_for(&self, category: &ProposalCategory) -> i64 {
        match category {
            ProposalCategory::EmergencyPause => self.vote_window_secs_emergency,
            ProposalCategory::Meta => self.vote_window_secs_meta,
            _ => self.vote_window_secs_standard,
        }
    }

    pub fn timelock_for(&self, category: &ProposalCategory, is_critical: bool) -> i64 {
        let base = match category {
            ProposalCategory::Meta => self.timelock_secs_meta,
            _ if is_critical => self.timelock_secs_critical,
            _ => self.timelock_secs_standard,
        };
        base.max(self.dev_mode_timelock_override_secs)
    }

    pub fn threshold_for(&self, category: &ProposalCategory) -> u16 {
        match category {
            ProposalCategory::Meta => self.meta_pass_threshold_bps,
            _ => self.pass_threshold_bps,
        }
    }
}

pub fn verify_vote_proof(proof: &[[u8; 32]], root: &[u8; 32], leaf: [u8; 32]) -> bool {
    let mut computed = leaf;
    for node in proof {
        computed = if computed <= *node {
            solana_sha256_hasher::hashv(&[&computed, node]).to_bytes()
        } else {
            solana_sha256_hasher::hashv(&[node, &computed]).to_bytes()
        };
    }
    computed == *root
}

pub fn compute_vote_leaf(voter: &Pubkey, weight: u128) -> [u8; 32] {
    solana_sha256_hasher::hashv(&[voter.as_ref(), &weight.to_le_bytes()]).to_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vote_window_categories() {
        let c = GovernanceConfig {
            authority: Pubkey::default(),
            nxs_staking: Pubkey::default(),
            capability_registry: Pubkey::default(),
            fee_collector: Pubkey::default(),
            emergency_council: Pubkey::default(),
            min_proposer_stake: 0,
            proposer_collateral: 0,
            vote_window_secs_standard: 5 * 86400,
            vote_window_secs_emergency: 86400,
            vote_window_secs_meta: 7 * 86400,
            quorum_bps: 400,
            pass_threshold_bps: 5000,
            meta_pass_threshold_bps: 6667,
            timelock_secs_standard: 7 * 86400,
            timelock_secs_critical: 14 * 86400,
            timelock_secs_meta: 21 * 86400,
            min_lock_to_vote_secs: 30 * 86400,
            dev_mode_timelock_override_secs: 0,
            next_proposal_id: 0,
            next_emergency_id: 0,
            paused: false,
            bump: 0,
        };
        assert_eq!(c.vote_window_for(&ProposalCategory::ParameterChange), 5 * 86400);
        assert_eq!(c.vote_window_for(&ProposalCategory::EmergencyPause), 86400);
        assert_eq!(c.vote_window_for(&ProposalCategory::Meta), 7 * 86400);
    }

    #[test]
    fn timelock_critical_vs_standard() {
        let c = GovernanceConfig {
            authority: Pubkey::default(),
            nxs_staking: Pubkey::default(),
            capability_registry: Pubkey::default(),
            fee_collector: Pubkey::default(),
            emergency_council: Pubkey::default(),
            min_proposer_stake: 0,
            proposer_collateral: 0,
            vote_window_secs_standard: 0,
            vote_window_secs_emergency: 0,
            vote_window_secs_meta: 0,
            quorum_bps: 0,
            pass_threshold_bps: 0,
            meta_pass_threshold_bps: 0,
            timelock_secs_standard: 7 * 86400,
            timelock_secs_critical: 14 * 86400,
            timelock_secs_meta: 21 * 86400,
            min_lock_to_vote_secs: 0,
            dev_mode_timelock_override_secs: 0,
            next_proposal_id: 0,
            next_emergency_id: 0,
            paused: false,
            bump: 0,
        };
        assert_eq!(c.timelock_for(&ProposalCategory::ParameterChange, false), 7 * 86400);
        assert_eq!(c.timelock_for(&ProposalCategory::ParameterChange, true), 14 * 86400);
        assert_eq!(c.timelock_for(&ProposalCategory::Meta, false), 21 * 86400);
    }

    #[test]
    fn merkle_vote_proof() {
        let v1 = Pubkey::new_from_array([1u8; 32]);
        let v2 = Pubkey::new_from_array([2u8; 32]);
        let leaf1 = compute_vote_leaf(&v1, 100);
        let leaf2 = compute_vote_leaf(&v2, 200);
        let root = if leaf1 <= leaf2 {
            solana_sha256_hasher::hashv(&[&leaf1, &leaf2]).to_bytes()
        } else {
            solana_sha256_hasher::hashv(&[&leaf2, &leaf1]).to_bytes()
        };
        assert!(verify_vote_proof(&[leaf2], &root, leaf1));
        assert!(verify_vote_proof(&[leaf1], &root, leaf2));
    }
}
