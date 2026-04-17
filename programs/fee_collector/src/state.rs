use anchor_lang::prelude::*;

// ── hook allowlist ─────────────────────────────────────────────

pub const MAX_HOOK_PROGRAMS: usize = 16;
pub const MAX_AGENT_HOOK_PROGRAMS: usize = 4;

pub const SEED_HOOK_ALLOWLIST: &[u8] = b"hook_allowlist";
pub const SEED_AGENT_HOOKS: &[u8] = b"agent_hooks";

#[account]
#[derive(InitSpace)]
pub struct HookAllowlist {
    pub authority: Pubkey,
    pub pending_authority: Option<Pubkey>,
    #[max_len(MAX_HOOK_PROGRAMS)]
    pub programs: Vec<Pubkey>,
    pub default_deny: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct AgentHookAllowlist {
    pub agent_did: [u8; 32],
    #[max_len(MAX_AGENT_HOOK_PROGRAMS)]
    pub extra_programs: Vec<Pubkey>,
    pub bump: u8,
}

// ── call-site ids ──────────────────────────────────────────────

pub const SITE_FUND_TASK: u8 = 1;
pub const SITE_RELEASE: u8 = 2;
pub const SITE_EXPIRE: u8 = 3;
pub const SITE_STREAM_WITHDRAW: u8 = 4;
pub const SITE_STREAM_SWAP: u8 = 5;
pub const SITE_STREAM_CLOSE: u8 = 6;
pub const SITE_COMMIT_BID_BOND: u8 = 7;
pub const SITE_CLAIM_BOND_REFUND: u8 = 8;
pub const SITE_CLAIM_BOND_SLASH: u8 = 9;
pub const SITE_FUND_TREASURY: u8 = 10;
pub const SITE_WITHDRAW: u8 = 11;
pub const SITE_INIT_STREAM: u8 = 12;

pub const MINT_FLAG_NO_TRANSFER_FEE: u32 = 1 << 0;
pub const MINT_FLAG_NO_FROZEN_DEFAULT: u32 = 1 << 1;
pub const MINT_FLAG_NO_PERMANENT_DELEGATE: u32 = 1 << 2;
pub const MINT_FLAG_HOOK_OK: u32 = 1 << 3;
pub const MINT_FLAG_ALL: u32 = MINT_FLAG_NO_TRANSFER_FEE
    | MINT_FLAG_NO_FROZEN_DEFAULT
    | MINT_FLAG_NO_PERMANENT_DELEGATE
    | MINT_FLAG_HOOK_OK;

// ── fee distribution ───────────────────────────────────────────

pub const SEED_FEE_CONFIG: &[u8] = b"fee_config";
pub const SEED_EPOCH: &[u8] = b"epoch";
pub const SEED_CLAIM: &[u8] = b"claim";
pub const SEED_INTAKE_VAULT: &[u8] = b"intake_vault";
pub const SEED_BURN_VAULT: &[u8] = b"burn_vault";
pub const SEED_STAKER_VAULT: &[u8] = b"staker_vault";

pub const BPS_DENOMINATOR: u64 = 10_000;
pub const MAX_HARVEST_HOLDERS: usize = 10;
pub const MAX_GC_CLAIMS: usize = 10;
pub const MAX_MERKLE_PROOF_DEPTH: usize = 24;

pub const DEFAULT_BURN_BPS: u16 = 1_000;
pub const DEFAULT_STAKER_BPS: u16 = 5_000;
pub const DEFAULT_GRANT_BPS: u16 = 2_000;
pub const DEFAULT_TREASURY_BPS: u16 = 2_000;

pub const DEFAULT_EPOCH_DURATION: i64 = 7 * 86_400;
pub const DEFAULT_CLAIM_WINDOW: i64 = 90 * 86_400;
pub const SWEEP_GRACE_SECS: i64 = 7 * 86_400;
pub const DISTRIBUTION_WINDOW_SECS: i64 = 2 * 86_400;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum EpochStatus {
    Open,
    Splitting,
    DistributionCommitted,
    Stale,
}

#[account]
#[derive(InitSpace)]
pub struct FeeCollectorConfig {
    pub authority: Pubkey,
    pub pending_authority: Option<Pubkey>,
    pub meta_authority: Pubkey,
    pub governance_program: Pubkey,
    pub nxs_staking: Pubkey,
    pub agent_registry: Pubkey,
    pub dispute_arbitration: Pubkey,
    pub emergency_council: Pubkey,
    pub saep_mint: Pubkey,
    pub grant_recipient: Pubkey,
    pub treasury_recipient: Pubkey,
    pub burn_bps: u16,
    pub staker_share_bps: u16,
    pub grant_share_bps: u16,
    pub treasury_share_bps: u16,
    pub burn_cap_bps: u16,
    pub staker_cap_bps: u16,
    pub grant_cap_bps: u16,
    pub treasury_cap_bps: u16,
    pub epoch_duration_secs: i64,
    pub next_epoch_id: u64,
    pub claim_window_secs: i64,
    pub min_epoch_total_for_burn: u64,
    pub paused: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct EpochAccount {
    pub epoch_id: u64,
    pub status: EpochStatus,
    pub started_at_slot: u64,
    pub started_at_ts: i64,
    pub closed_at_slot: Option<u64>,
    pub closed_at_ts: Option<i64>,
    pub snapshot_id: u64,
    pub total_collected: u64,
    pub burn_amount: u64,
    pub burn_executed: bool,
    pub staker_amount: u64,
    pub staker_distribution_root: [u8; 32],
    pub staker_distribution_committed: bool,
    pub staker_claimed_total: u64,
    pub grant_amount: u64,
    pub treasury_amount: u64,
    pub stale_swept: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct StakerClaim {
    pub epoch_id: u64,
    pub staker: Pubkey,
    pub amount_claimed: u64,
    pub claimed_at_slot: u64,
    pub bump: u8,
}

/// Split total into 4 buckets by bps. Dust ≤ 3 goes to treasury.
pub fn compute_bps_split(
    total: u64,
    burn_bps: u16,
    staker_bps: u16,
    grant_bps: u16,
    _treasury_bps: u16,
) -> (u64, u64, u64, u64) {
    let burn = ((total as u128) * (burn_bps as u128) / (BPS_DENOMINATOR as u128)) as u64;
    let staker = ((total as u128) * (staker_bps as u128) / (BPS_DENOMINATOR as u128)) as u64;
    let grant = ((total as u128) * (grant_bps as u128) / (BPS_DENOMINATOR as u128)) as u64;
    let treasury = total.saturating_sub(burn).saturating_sub(staker).saturating_sub(grant);
    (burn, staker, grant, treasury)
}

/// Verify merkle inclusion: leaf = hash(staker || amount || epoch_id)
pub fn verify_merkle_proof(proof: &[[u8; 32]], root: &[u8; 32], leaf: [u8; 32]) -> bool {
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

/// Compute leaf hash for a staker claim
pub fn compute_claim_leaf(staker: &Pubkey, amount: u64, epoch_id: u64) -> [u8; 32] {
    solana_sha256_hasher::hashv(&[
        staker.as_ref(),
        &amount.to_le_bytes(),
        &epoch_id.to_le_bytes(),
    ])
    .to_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bps_split_exact() {
        let (b, s, g, t) = compute_bps_split(10_000, 1_000, 5_000, 2_000, 2_000);
        assert_eq!(b, 1_000);
        assert_eq!(s, 5_000);
        assert_eq!(g, 2_000);
        assert_eq!(t, 2_000);
        assert_eq!(b + s + g + t, 10_000);
    }

    #[test]
    fn bps_split_dust_to_treasury() {
        // 3 tokens, 10% burn = 0.3 → 0, staker 50% = 1.5 → 1, grant 20% = 0.6 → 0
        // treasury gets remainder = 3 - 0 - 1 - 0 = 2
        let (b, s, g, t) = compute_bps_split(3, 1_000, 5_000, 2_000, 2_000);
        assert_eq!(b + s + g + t, 3);
        assert_eq!(t, 2); // dust lands in treasury
    }

    #[test]
    fn bps_split_zero() {
        let (b, s, g, t) = compute_bps_split(0, 1_000, 5_000, 2_000, 2_000);
        assert_eq!(b + s + g + t, 0);
    }

    #[test]
    fn bps_split_large() {
        let total = u64::MAX / 2;
        let (b, s, g, t) = compute_bps_split(total, 1_000, 5_000, 2_000, 2_000);
        assert_eq!(b + s + g + t, total);
    }

    #[test]
    fn merkle_single_leaf() {
        let staker = Pubkey::new_from_array([1u8; 32]);
        let leaf = compute_claim_leaf(&staker, 100, 0);
        assert!(verify_merkle_proof(&[], &leaf, leaf));
    }

    #[test]
    fn merkle_two_leaves() {
        let s1 = Pubkey::new_from_array([1u8; 32]);
        let s2 = Pubkey::new_from_array([2u8; 32]);
        let leaf1 = compute_claim_leaf(&s1, 100, 0);
        let leaf2 = compute_claim_leaf(&s2, 200, 0);

        let root = if leaf1 <= leaf2 {
            solana_sha256_hasher::hashv(&[&leaf1, &leaf2]).to_bytes()
        } else {
            solana_sha256_hasher::hashv(&[&leaf2, &leaf1]).to_bytes()
        };

        assert!(verify_merkle_proof(&[leaf2], &root, leaf1));
        assert!(verify_merkle_proof(&[leaf1], &root, leaf2));
    }

    #[test]
    fn merkle_bad_proof_fails() {
        let staker = Pubkey::new_from_array([1u8; 32]);
        let leaf = compute_claim_leaf(&staker, 100, 0);
        let bad_root = [0u8; 32];
        assert!(!verify_merkle_proof(&[], &bad_root, leaf));
    }
}
