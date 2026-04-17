use anchor_lang::prelude::*;

// --- Seeds ---
pub const SEED_DISPUTE_CONFIG: &[u8] = b"dispute_config";
pub const SEED_GUARD: &[u8] = b"guard";
pub const SEED_ALLOWED_CALLERS: &[u8] = b"allowed_callers";
pub const SEED_ARBITRATOR: &[u8] = b"arbitrator";
pub const SEED_DISPUTE_POOL: &[u8] = b"dispute_pool";
pub const SEED_DISPUTE_CASE: &[u8] = b"dispute_case";
pub const SEED_DISPUTE_VOTE: &[u8] = b"dispute_vote";
pub const SEED_APPEAL: &[u8] = b"appeal";
pub const SEED_PENDING_SLASH: &[u8] = b"pending_slash";

// --- Constants ---
pub const MAX_ALLOWED_CALLERS: usize = 8;
pub const MAX_CPI_STACK_HEIGHT: usize = 3;
pub const ADMIN_RESET_TIMELOCK_SECS: i64 = 24 * 60 * 60;
pub const MAX_POOL_SIZE: usize = 256;
pub const MAX_ROUND2_ARBITRATORS: usize = 5;
pub const MAX_ROUND1_ARBITRATORS: usize = 3;
pub const DEFAULT_COMMIT_WINDOW_SECS: i64 = 86_400;
pub const DEFAULT_REVEAL_WINDOW_SECS: i64 = 86_400;
pub const DEFAULT_APPEAL_WINDOW_SECS: i64 = 86_400;
pub const DEFAULT_APPEAL_COLLATERAL_BPS: u16 = 15_000;
pub const DEFAULT_MAX_SLASH_BPS: u16 = 1_000;
pub const DEFAULT_SLASH_TIMELOCK_SECS: i64 = 30 * 24 * 60 * 60;
pub const DEFAULT_VRF_STALE_SLOTS: u64 = 150;
pub const DEFAULT_BAD_FAITH_THRESHOLD: u8 = 3;
pub const DEFAULT_BAD_FAITH_LOOKBACK: u8 = 10;
pub const BPS_DENOMINATOR: u64 = 10_000;

// --- Enums ---

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum ArbitratorStatus {
    Active,
    Paused,
    Slashed,
    Withdrawing,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum DisputeStatus {
    RequestedVrf,
    SelectionReady,
    Committing,
    Revealing,
    Tallied,
    Appealed,
    Resolved,
    Cancelled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum DisputeVerdict {
    None,
    AgentWins,
    ClientWins,
    Split,
}

// --- Guard Accounts ---

#[account]
#[derive(InitSpace)]
pub struct ReentrancyGuard {
    pub active: bool,
    pub entered_by: Pubkey,
    pub entered_at_slot: u64,
    pub reset_proposed_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct AllowedCallers {
    #[max_len(8)]
    pub programs: Vec<Pubkey>,
    pub bump: u8,
}

// --- Config ---

#[account]
#[derive(InitSpace)]
pub struct DisputeConfig {
    pub authority: Pubkey,
    pub pending_authority: Pubkey,
    pub task_market: Pubkey,
    pub nxs_staking: Pubkey,
    pub fee_collector: Pubkey,
    pub agent_registry: Pubkey,
    pub switchboard_program: Pubkey,
    pub emergency_council: Pubkey,
    pub round1_size: u8,
    pub round2_size: u8,
    pub commit_window_secs: i64,
    pub reveal_window_secs: i64,
    pub appeal_window_secs: i64,
    pub appeal_collateral_bps: u16,
    pub max_slash_bps: u16,
    pub slash_timelock_secs: i64,
    pub min_stake: u64,
    pub min_lock_secs: i64,
    pub vrf_stale_slots: u64,
    pub round2_window_secs: i64,
    pub bad_faith_threshold: u8,
    pub bad_faith_lookback: u8,
    pub next_case_id: u64,
    pub paused: bool,
    pub bump: u8,
}

// --- Arbitrator ---

#[account]
#[derive(InitSpace)]
pub struct ArbitratorAccount {
    pub operator: Pubkey,
    pub stake_account: Pubkey,
    pub effective_stake: u64,
    pub effective_lock_end: i64,
    pub status: ArbitratorStatus,
    pub bad_faith_strikes: u8,
    pub cases_participated: u32,
    pub withdraw_unlock_time: i64,
    pub registered_at: i64,
    pub bump: u8,
}

// --- Pool ---

#[account]
#[derive(InitSpace)]
pub struct DisputePool {
    pub snapshot_epoch: u64,
    pub snapshot_time: i64,
    pub total_staked: u128,
    pub arbitrator_count: u16,
    #[max_len(256)]
    pub arbitrators: Vec<Pubkey>,
    #[max_len(256)]
    pub cumulative_stakes: Vec<u64>,
    pub bump: u8,
}

// --- Dispute Case ---

#[account]
#[derive(InitSpace)]
pub struct DisputeCase {
    pub case_id: u64,
    pub task_id: u64,
    pub client: Pubkey,
    pub agent_operator: Pubkey,
    pub escrow_amount: u64,
    pub payment_mint: Pubkey,
    pub status: DisputeStatus,
    pub round: u8,
    #[max_len(5)]
    pub arbitrators: Vec<Pubkey>,
    pub arbitrator_count: u8,
    pub vrf_request: Pubkey,
    pub vrf_result: [u8; 32],
    pub commit_deadline: i64,
    pub reveal_deadline: i64,
    pub verdict: DisputeVerdict,
    pub votes_for_agent: u128,
    pub votes_for_client: u128,
    pub votes_for_split: u128,
    pub total_revealed_weight: u128,
    pub resolved_at: i64,
    pub created_at: i64,
    pub snapshot_pool: Pubkey,
    pub bump: u8,
}

// --- Vote Record ---

#[account]
#[derive(InitSpace)]
pub struct DisputeVoteRecord {
    pub case_id: u64,
    pub arbitrator: Pubkey,
    pub round: u8,
    pub commit_hash: [u8; 32],
    pub committed_at: i64,
    pub revealed_verdict: DisputeVerdict,
    pub revealed: bool,
    pub revealed_weight: u128,
    pub revealed_at: i64,
    pub bump: u8,
}

// --- Appeal ---

#[account]
#[derive(InitSpace)]
pub struct AppealRecord {
    pub case_id: u64,
    pub appellant: Pubkey,
    pub round: u8,
    pub collateral_amount: u64,
    pub collateral_mint: Pubkey,
    pub filed_at: i64,
    pub bump: u8,
}

// --- Pending Slash ---

#[account]
#[derive(InitSpace)]
pub struct PendingSlash {
    pub arbitrator: Pubkey,
    pub case_id: u64,
    pub amount: u64,
    pub reason_code: u8,
    pub executable_at: i64,
    pub bump: u8,
}

// --- Helpers ---

pub fn compute_commit_hash(verdict: &DisputeVerdict, salt: &[u8; 32]) -> [u8; 32] {
    let verdict_byte = match verdict {
        DisputeVerdict::None => 0u8,
        DisputeVerdict::AgentWins => 1u8,
        DisputeVerdict::ClientWins => 2u8,
        DisputeVerdict::Split => 3u8,
    };
    let hash = solana_sha256_hasher::hashv(&[&[verdict_byte], salt.as_ref()]);
    hash.to_bytes()
}

pub fn weighted_select(
    vrf_bytes: &[u8; 32],
    cumulative_stakes: &[u64],
    count: usize,
    offset: usize,
) -> Vec<usize> {
    if cumulative_stakes.is_empty() || count == 0 {
        return vec![];
    }
    let total = *cumulative_stakes.last().unwrap() as u128;
    if total == 0 {
        return vec![];
    }

    let mut selected = Vec::with_capacity(count);
    let excluded: Vec<usize> = Vec::new();

    for i in 0..count {
        let seed_input = [
            vrf_bytes.as_ref(),
            &(offset + i).to_le_bytes(),
        ];
        let h = solana_sha256_hasher::hashv(&seed_input);
        let rand_bytes: [u8; 16] = h.to_bytes()[..16].try_into().unwrap();
        let rand_val = u128::from_le_bytes(rand_bytes) % total;

        let mut idx = match cumulative_stakes.binary_search(&(rand_val as u64)) {
            Ok(i) => i,
            Err(i) => i,
        };

        // skip already-selected or excluded
        let mut attempts = 0;
        while (selected.contains(&idx) || excluded.contains(&idx))
            && attempts < cumulative_stakes.len()
        {
            idx = (idx + 1) % cumulative_stakes.len();
            attempts += 1;
        }
        if attempts >= cumulative_stakes.len() {
            break;
        }
        selected.push(idx);
    }
    selected
}
