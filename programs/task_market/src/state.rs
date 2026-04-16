use anchor_lang::prelude::*;

use crate::errors::TaskMarketError;

pub const ALLOWED_MINTS_LEN: usize = 8;
pub const MAX_MILESTONES: u8 = 8;
pub const MAX_PROTOCOL_FEE_BPS: u16 = 100;
pub const MAX_SOLREP_FEE_BPS: u16 = 100;
pub const BPS_DENOM: u128 = 10_000;
pub const CANCEL_GRACE_SECS: i64 = 300;
pub const EXPIRE_GRACE_SECS: i64 = 3_600;
pub const MIN_DEADLINE_SECS: i64 = 60;

pub const MAX_BIDDERS_PER_TASK: u16 = 64;
pub const DEFAULT_COMMIT_WINDOW_SECS: i64 = 300;
pub const DEFAULT_REVEAL_WINDOW_SECS: i64 = 180;
pub const MIN_BID_BOND_BPS: u16 = 50;
pub const MAX_BID_BOND_BPS: u16 = 500;

// TaskPayload caps — keep total on-chain payload <1 KiB. Larger artifacts go
// via `criteria_root` (merkle-committed off-chain blob), not free-form bytes.
// See specs/pre-audit-01-typed-task-schema.md §task_market.
pub const MAX_CRITERIA_LEN: usize = 128;
pub const MAX_CAPABILITY_BIT: u16 = 127;

pub const SEED_BID_BOOK: &[u8] = b"bid_book";
pub const SEED_BID: &[u8] = b"bid";
pub const SEED_BOND_ESCROW: &[u8] = b"bond_escrow";

#[account]
#[derive(InitSpace)]
pub struct MarketGlobal {
    pub authority: Pubkey,
    pub pending_authority: Option<Pubkey>,
    pub agent_registry: Pubkey,
    pub treasury_standard: Pubkey,
    pub proof_verifier: Pubkey,
    pub fee_collector: Pubkey,
    pub solrep_pool: Pubkey,
    pub protocol_fee_bps: u16,
    pub solrep_fee_bps: u16,
    pub dispute_window_secs: i64,
    pub max_deadline_secs: i64,
    pub allowed_payment_mints: [Pubkey; ALLOWED_MINTS_LEN],
    pub paused: bool,
    pub bump: u8,
}

// Typed task payload. Variant set per specs/pre-audit-01-typed-task-schema.md §task_market.
// Each variant is fixed-layout (no nested Vec<u8>) so borsh-deserialize caps size
// deterministically; capability_bit binds the task to an agent capability advertised
// in capability_registry + agent_account.capability_mask.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug, InitSpace)]
pub enum TaskKind {
    SwapExact {
        in_mint: Pubkey,
        out_mint: Pubkey,
        amount_in: u64,
        min_out: u64,
    },
    Transfer {
        mint: Pubkey,
        to: Pubkey,
        amount: u64,
    },
    DataFetch {
        url_hash: [u8; 32],
        expected_hash: [u8; 32],
    },
    Compute {
        circuit_id: [u8; 32],
        public_inputs_hash: [u8; 32],
    },
    Generic {
        capability_bit: u16,
        args_hash: [u8; 32],
    },
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug, InitSpace)]
pub struct TaskPayload {
    pub kind: TaskKind,
    pub capability_bit: u16,
    #[max_len(MAX_CRITERIA_LEN)]
    pub criteria: Vec<u8>,
}

impl TaskPayload {
    pub fn kind_discriminant(&self) -> u8 {
        match self.kind {
            TaskKind::SwapExact { .. } => 0,
            TaskKind::Transfer { .. } => 1,
            TaskKind::DataFetch { .. } => 2,
            TaskKind::Compute { .. } => 3,
            TaskKind::Generic { .. } => 4,
        }
    }

    pub fn validate(&self) -> Result<()> {
        require!(
            self.capability_bit <= MAX_CAPABILITY_BIT,
            TaskMarketError::InvalidCapabilityBit
        );
        require!(
            self.criteria.len() <= MAX_CRITERIA_LEN,
            TaskMarketError::PayloadTooLarge
        );
        Ok(())
    }

    pub fn hash(&self) -> Result<[u8; 32]> {
        let mut bytes = Vec::new();
        <TaskPayload as AnchorSerialize>::serialize(self, &mut bytes)
            .map_err(|_| error!(TaskMarketError::PayloadTooLarge))?;
        Ok(solana_keccak_hasher::hashv(&[&bytes]).to_bytes())
    }
}

pub fn derive_task_hash(task_id: &[u8; 32], payload: &TaskPayload) -> Result<[u8; 32]> {
    let payload_hash = payload.hash()?;
    Ok(solana_keccak_hasher::hashv(&[task_id, &payload_hash]).to_bytes())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum TaskStatus {
    Created,
    Funded,
    InExecution,
    ProofSubmitted,
    Verified,
    Released,
    Expired,
    Disputed,
    Resolved,
}

#[account]
#[derive(InitSpace)]
pub struct TaskContract {
    pub task_id: [u8; 32],
    pub client: Pubkey,
    pub agent_did: [u8; 32],
    pub task_nonce: [u8; 8],
    pub payment_mint: Pubkey,
    pub payment_amount: u64,
    pub protocol_fee: u64,
    pub solrep_fee: u64,
    pub task_hash: [u8; 32],
    pub result_hash: [u8; 32],
    pub proof_key: [u8; 32],
    pub criteria_root: [u8; 32],
    pub milestone_count: u8,
    pub milestones_complete: u8,
    pub status: TaskStatus,
    pub created_at: i64,
    pub funded_at: i64,
    pub deadline: i64,
    pub submitted_at: i64,
    pub dispute_window_end: i64,
    pub verified: bool,
    pub bump: u8,
    pub escrow_bump: u8,
    pub bid_book: Option<Pubkey>,
    pub assigned_agent: Option<Pubkey>,
    pub payload: TaskPayload,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum BidPhase {
    Commit,
    Reveal,
    Settled,
    Cancelled,
}

#[account]
#[derive(InitSpace)]
pub struct BidBook {
    pub task_id: [u8; 32],
    pub commit_start: i64,
    pub commit_end: i64,
    pub reveal_end: i64,
    pub bond_amount: u64,
    pub bond_mint: Pubkey,
    pub commit_count: u16,
    pub reveal_count: u16,
    pub winner_agent: Option<Pubkey>,
    pub winner_amount: u64,
    pub phase: BidPhase,
    pub bump: u8,
    pub escrow_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Bid {
    pub task_id: [u8; 32],
    pub agent_did: [u8; 32],
    pub bidder: Pubkey,
    pub commit_hash: [u8; 32],
    pub bond_paid: u64,
    pub revealed_amount: u64,
    pub revealed: bool,
    pub refunded: bool,
    pub slashed: bool,
    pub bump: u8,
}

pub fn compute_bond_amount(payment_amount: u64, bond_bps: u16) -> Result<u64> {
    let amt = payment_amount as u128;
    let bond = amt
        .checked_mul(bond_bps as u128)
        .ok_or(TaskMarketError::ArithmeticOverflow)?
        / BPS_DENOM;
    u64::try_from(bond).map_err(|_| TaskMarketError::ArithmeticOverflow.into())
}

pub fn reveal_commit_hash(amount: u64, nonce: &[u8; 32], agent_did: &[u8; 32]) -> [u8; 32] {
    let amount_le = amount.to_le_bytes();
    solana_keccak_hasher::hashv(&[&amount_le[..], &nonce[..], &agent_did[..]]).to_bytes()
}

pub fn bid_beats(
    candidate_amount: u64,
    candidate_stake: u64,
    candidate_key: &Pubkey,
    current_amount: u64,
    current_stake: u64,
    current_key: &Pubkey,
) -> bool {
    if candidate_amount != current_amount {
        return candidate_amount < current_amount;
    }
    if candidate_stake != current_stake {
        return candidate_stake > current_stake;
    }
    candidate_key < current_key
}

pub fn is_allowed_mint(list: &[Pubkey; ALLOWED_MINTS_LEN], mint: &Pubkey) -> bool {
    list.iter().any(|m| m == mint)
}

pub fn compute_task_id(client: &Pubkey, task_nonce: &[u8; 8], created_at: i64) -> [u8; 32] {
    // M1: keccak over the canonical tuple. Poseidon2 swap is a no-op field
    // rename for the circuit — hash identity doesn't matter on-chain since the
    // circuit consumes `task_hash`, not `task_id`.
    let mut buf = Vec::with_capacity(32 + 8 + 8);
    buf.extend_from_slice(client.as_ref());
    buf.extend_from_slice(task_nonce);
    buf.extend_from_slice(&created_at.to_le_bytes());
    solana_keccak_hasher::hashv(&[&buf]).to_bytes()
}

pub fn compute_fees(amount: u64, protocol_bps: u16, solrep_bps: u16) -> Result<(u64, u64)> {
    let amt = amount as u128;
    let pf = amt
        .checked_mul(protocol_bps as u128)
        .ok_or(TaskMarketError::ArithmeticOverflow)?
        / BPS_DENOM;
    let sf = amt
        .checked_mul(solrep_bps as u128)
        .ok_or(TaskMarketError::ArithmeticOverflow)?
        / BPS_DENOM;
    let pf: u64 = pf.try_into().map_err(|_| TaskMarketError::ArithmeticOverflow)?;
    let sf: u64 = sf.try_into().map_err(|_| TaskMarketError::ArithmeticOverflow)?;
    let sum = pf
        .checked_add(sf)
        .ok_or(TaskMarketError::ArithmeticOverflow)?;
    require!(sum < amount, TaskMarketError::InvalidAmount);
    Ok((pf, sf))
}

#[cfg(test)]
mod proptests {
    use super::*;
    use anchor_lang::{AnchorDeserialize, AnchorSerialize};
    use proptest::prelude::*;

    proptest! {
        #[test]
        fn compute_fees_no_panic(
            amount in any::<u64>(),
            p_bps in 0u16..=MAX_PROTOCOL_FEE_BPS,
            s_bps in 0u16..=MAX_SOLREP_FEE_BPS,
        ) {
            let _ = compute_fees(amount, p_bps, s_bps);
        }

        #[test]
        fn compute_fees_sum_lt_amount_within_bound(
            amount in 1u64..=u64::MAX,
            p_bps in 0u16..=MAX_PROTOCOL_FEE_BPS,
            s_bps in 0u16..=MAX_SOLREP_FEE_BPS,
        ) {
            let (pf, sf) = compute_fees(amount, p_bps, s_bps).unwrap();
            let sum = pf as u128 + sf as u128;
            prop_assert!(sum < amount as u128);
            let cap = (amount as u128).saturating_mul(p_bps as u128 + s_bps as u128) / BPS_DENOM;
            prop_assert!(sum <= cap);
        }

        #[test]
        fn compute_fees_zero_bps_zero_fees(amount in 1u64..=u64::MAX) {
            let (pf, sf) = compute_fees(amount, 0, 0).unwrap();
            prop_assert_eq!(pf, 0);
            prop_assert_eq!(sf, 0);
        }

        #[test]
        fn compute_fees_monotonic_in_bps(
            amount in 1u64..=u64::MAX / 100,
            p_bps_lo in 0u16..=MAX_PROTOCOL_FEE_BPS,
            p_bps_hi in 0u16..=MAX_PROTOCOL_FEE_BPS,
            s_bps in 0u16..=MAX_SOLREP_FEE_BPS,
        ) {
            let lo = p_bps_lo.min(p_bps_hi);
            let hi = p_bps_lo.max(p_bps_hi);
            let (pf_lo, _) = compute_fees(amount, lo, s_bps).unwrap();
            let (pf_hi, _) = compute_fees(amount, hi, s_bps).unwrap();
            prop_assert!(pf_lo <= pf_hi);
        }
    }

    #[test]
    fn compute_fees_zero_amount_rejected() {
        assert!(compute_fees(0, 50, 50).is_err());
    }

    #[test]
    fn bid_book_bond_zero_bps_is_zero() {
        assert_eq!(compute_bond_amount(1_000_000, 0).unwrap(), 0);
    }

    #[test]
    fn bid_book_bond_min_bps() {
        assert_eq!(compute_bond_amount(1_000_000, MIN_BID_BOND_BPS).unwrap(), 5_000);
    }

    #[test]
    fn bid_book_bond_max_bps() {
        assert_eq!(compute_bond_amount(1_000_000, MAX_BID_BOND_BPS).unwrap(), 50_000);
    }

    proptest! {
        #[test]
        fn bid_book_bond_monotonic_in_bps(
            amount in 1u64..=u64::MAX / 10_000,
            lo_bps in MIN_BID_BOND_BPS..=MAX_BID_BOND_BPS,
            hi_bps in MIN_BID_BOND_BPS..=MAX_BID_BOND_BPS,
        ) {
            let lo = lo_bps.min(hi_bps);
            let hi = lo_bps.max(hi_bps);
            let a = compute_bond_amount(amount, lo).unwrap();
            let b = compute_bond_amount(amount, hi).unwrap();
            prop_assert!(a <= b);
        }

        #[test]
        fn bid_book_bond_no_panic(
            amount in any::<u64>(),
            bps in 0u16..=MAX_BID_BOND_BPS,
        ) {
            let _ = compute_bond_amount(amount, bps);
        }
    }

    #[test]
    fn bid_book_reveal_hash_deterministic() {
        let did = [7u8; 32];
        let nonce = [9u8; 32];
        let a = reveal_commit_hash(1_000, &nonce, &did);
        let b = reveal_commit_hash(1_000, &nonce, &did);
        assert_eq!(a, b);
    }

    #[test]
    fn bid_book_reveal_hash_amount_sensitive() {
        let did = [7u8; 32];
        let nonce = [9u8; 32];
        let a = reveal_commit_hash(1_000, &nonce, &did);
        let b = reveal_commit_hash(1_001, &nonce, &did);
        assert_ne!(a, b);
    }

    #[test]
    fn bid_book_reveal_hash_nonce_sensitive() {
        let did = [7u8; 32];
        let mut nonce_a = [9u8; 32];
        let mut nonce_b = [9u8; 32];
        nonce_b[0] = 10;
        assert_ne!(
            reveal_commit_hash(1_000, &nonce_a, &did),
            reveal_commit_hash(1_000, &nonce_b, &did),
        );
        nonce_a[0] = 9;
    }

    #[test]
    fn bid_book_beats_lower_amount_wins() {
        let k1 = Pubkey::new_from_array([1u8; 32]);
        let k2 = Pubkey::new_from_array([2u8; 32]);
        assert!(bid_beats(100, 0, &k1, 200, 999, &k2));
        assert!(!bid_beats(200, 999, &k1, 100, 0, &k2));
    }

    #[test]
    fn bid_book_beats_tie_stake_breaks() {
        let k1 = Pubkey::new_from_array([1u8; 32]);
        let k2 = Pubkey::new_from_array([2u8; 32]);
        assert!(bid_beats(100, 500, &k1, 100, 100, &k2));
        assert!(!bid_beats(100, 100, &k1, 100, 500, &k2));
    }

    #[test]
    fn bid_book_beats_tie_stake_tie_pubkey_breaks() {
        let k_small = Pubkey::new_from_array([1u8; 32]);
        let k_large = Pubkey::new_from_array([9u8; 32]);
        assert!(bid_beats(100, 100, &k_small, 100, 100, &k_large));
        assert!(!bid_beats(100, 100, &k_large, 100, 100, &k_small));
    }

    fn payload_with_kind(kind: TaskKind, capability_bit: u16) -> TaskPayload {
        TaskPayload { kind, capability_bit, criteria: vec![] }
    }

    fn serialize(p: &TaskPayload) -> Vec<u8> {
        let mut v = Vec::new();
        <TaskPayload as AnchorSerialize>::serialize(p, &mut v).unwrap();
        v
    }

    #[test]
    fn task_payload_swap_exact_roundtrip() {
        let p = payload_with_kind(
            TaskKind::SwapExact {
                in_mint: Pubkey::new_from_array([1u8; 32]),
                out_mint: Pubkey::new_from_array([2u8; 32]),
                amount_in: 1_000,
                min_out: 900,
            },
            5,
        );
        let bytes = serialize(&p);
        let decoded = TaskPayload::try_from_slice(&bytes).unwrap();
        assert_eq!(decoded, p);
        assert_eq!(decoded.kind_discriminant(), 0);
    }

    #[test]
    fn task_payload_transfer_roundtrip() {
        let p = payload_with_kind(
            TaskKind::Transfer {
                mint: Pubkey::new_from_array([3u8; 32]),
                to: Pubkey::new_from_array([4u8; 32]),
                amount: 42,
            },
            1,
        );
        let bytes = serialize(&p);
        assert_eq!(TaskPayload::try_from_slice(&bytes).unwrap(), p);
        assert_eq!(p.kind_discriminant(), 1);
    }

    #[test]
    fn task_payload_data_fetch_roundtrip() {
        let p = payload_with_kind(
            TaskKind::DataFetch {
                url_hash: [9u8; 32],
                expected_hash: [7u8; 32],
            },
            0,
        );
        let bytes = serialize(&p);
        assert_eq!(TaskPayload::try_from_slice(&bytes).unwrap(), p);
        assert_eq!(p.kind_discriminant(), 2);
    }

    #[test]
    fn task_payload_compute_roundtrip() {
        let p = payload_with_kind(
            TaskKind::Compute {
                circuit_id: [1u8; 32],
                public_inputs_hash: [2u8; 32],
            },
            17,
        );
        let bytes = serialize(&p);
        assert_eq!(TaskPayload::try_from_slice(&bytes).unwrap(), p);
        assert_eq!(p.kind_discriminant(), 3);
    }

    #[test]
    fn task_payload_generic_roundtrip() {
        let p = payload_with_kind(
            TaskKind::Generic { capability_bit: 9, args_hash: [6u8; 32] },
            9,
        );
        let bytes = serialize(&p);
        assert_eq!(TaskPayload::try_from_slice(&bytes).unwrap(), p);
        assert_eq!(p.kind_discriminant(), 4);
    }

    #[test]
    fn task_payload_validate_rejects_oversized_criteria() {
        let p = TaskPayload {
            kind: TaskKind::Generic { capability_bit: 0, args_hash: [0u8; 32] },
            capability_bit: 0,
            criteria: vec![0u8; MAX_CRITERIA_LEN + 1],
        };
        assert!(p.validate().is_err());
    }

    #[test]
    fn task_payload_validate_rejects_out_of_range_capability() {
        let p = TaskPayload {
            kind: TaskKind::Generic { capability_bit: 0, args_hash: [0u8; 32] },
            capability_bit: MAX_CAPABILITY_BIT + 1,
            criteria: vec![],
        };
        assert!(p.validate().is_err());
    }

    #[test]
    fn task_payload_validate_accepts_max_criteria() {
        let p = TaskPayload {
            kind: TaskKind::Generic { capability_bit: 0, args_hash: [0u8; 32] },
            capability_bit: MAX_CAPABILITY_BIT,
            criteria: vec![0u8; MAX_CRITERIA_LEN],
        };
        assert!(p.validate().is_ok());
    }

    #[test]
    fn task_payload_unknown_discriminant_rejected() {
        // Borsh enum discriminants are u8; value 5 is past our highest variant (Generic = 4).
        let mut bytes = vec![5u8]; // invalid enum tag for TaskKind
        bytes.extend_from_slice(&0u16.to_le_bytes());
        bytes.extend_from_slice(&0u32.to_le_bytes()); // empty vec len
        assert!(TaskPayload::try_from_slice(&bytes).is_err());
    }

    #[test]
    fn task_payload_hash_is_deterministic() {
        let p = payload_with_kind(
            TaskKind::Transfer {
                mint: Pubkey::new_from_array([3u8; 32]),
                to: Pubkey::new_from_array([4u8; 32]),
                amount: 42,
            },
            1,
        );
        assert_eq!(p.hash().unwrap(), p.hash().unwrap());
    }

    #[test]
    fn task_payload_hash_binds_fields() {
        let a = payload_with_kind(
            TaskKind::Transfer {
                mint: Pubkey::new_from_array([3u8; 32]),
                to: Pubkey::new_from_array([4u8; 32]),
                amount: 42,
            },
            1,
        );
        let b = payload_with_kind(
            TaskKind::Transfer {
                mint: Pubkey::new_from_array([3u8; 32]),
                to: Pubkey::new_from_array([4u8; 32]),
                amount: 43,
            },
            1,
        );
        assert_ne!(a.hash().unwrap(), b.hash().unwrap());
    }

    #[test]
    fn derive_task_hash_differs_per_task_id() {
        let p = payload_with_kind(
            TaskKind::Generic { capability_bit: 2, args_hash: [1u8; 32] },
            2,
        );
        let h1 = derive_task_hash(&[1u8; 32], &p).unwrap();
        let h2 = derive_task_hash(&[2u8; 32], &p).unwrap();
        assert_ne!(h1, h2);
    }
}

