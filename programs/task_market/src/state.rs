use anchor_lang::prelude::*;

use agent_registry::state::PersonhoodTier;

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
pub const SEED_MINT_ACCEPT: &[u8] = b"mint_accept";

#[account]
#[derive(InitSpace)]
pub struct MintAcceptRecord {
    pub mint: Pubkey,
    pub mint_accept_flags: u32,
    pub hook_program: Option<Pubkey>,
    pub accepted_at_slot: u64,
    pub accepted_at_ts: i64,
    pub bump: u8,
}

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
    // fee_collector::HookAllowlist PDA pointer. Starts Pubkey::default() and is
    // wired once via governance::set_hook_allowlist_ptr; immutable once set.
    // See specs/pre-audit-05-transferhook-whitelist.md.
    pub hook_allowlist: Pubkey,
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
    pub requires_personhood: PersonhoodTier,
}

impl TaskPayload {
    pub fn new(kind: TaskKind, capability_bit: u16, criteria: Vec<u8>) -> Self {
        Self {
            kind,
            capability_bit,
            criteria,
            requires_personhood: PersonhoodTier::None,
        }
    }

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
    pub winner_bidder: Option<Pubkey>,
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

// Returns Some(&HookAllowlist) when MarketGlobal.hook_allowlist is wired and
// the passed account matches; None when wiring hasn't been done yet (M1 devnet
// warn-only). Errors if wired but the passed account doesn't match the pointer.
pub fn resolve_hook_allowlist<'a, 'info>(
    global: &MarketGlobal,
    passed: Option<&'a Account<'info, fee_collector::HookAllowlist>>,
) -> Result<Option<&'a fee_collector::HookAllowlist>> {
    if global.hook_allowlist == Pubkey::default() {
        return Ok(None);
    }
    let acct = passed.ok_or(TaskMarketError::HookAllowlistMismatch)?;
    require_keys_eq!(
        acct.key(),
        global.hook_allowlist,
        TaskMarketError::HookAllowlistMismatch
    );
    Ok(Some(acct.as_ref()))
}

// Pure-logic variant used by unit tests. Takes the pointer + passed key instead
// of an `Account` handle so tests can exercise the decision tree without an
// Anchor harness. Returns Ok(true) when the gate is active (check the hook),
// Ok(false) when the gate is unwired (skip), Err on mismatch.
pub fn hook_gate_active(
    global_ptr: &Pubkey,
    passed_key: Option<&Pubkey>,
) -> Result<bool> {
    if *global_ptr == Pubkey::default() {
        return Ok(false);
    }
    let k = passed_key.ok_or(TaskMarketError::HookAllowlistMismatch)?;
    require_keys_eq!(*k, *global_ptr, TaskMarketError::HookAllowlistMismatch);
    Ok(true)
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
        TaskPayload::new(kind, capability_bit, vec![])
    }

    fn payload_with_personhood(
        kind: TaskKind,
        capability_bit: u16,
        tier: PersonhoodTier,
    ) -> TaskPayload {
        let mut p = TaskPayload::new(kind, capability_bit, vec![]);
        p.requires_personhood = tier;
        p
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
        let p = TaskPayload::new(
            TaskKind::Generic { capability_bit: 0, args_hash: [0u8; 32] },
            0,
            vec![0u8; MAX_CRITERIA_LEN + 1],
        );
        assert!(p.validate().is_err());
    }

    #[test]
    fn task_payload_validate_rejects_out_of_range_capability() {
        let p = TaskPayload::new(
            TaskKind::Generic { capability_bit: 0, args_hash: [0u8; 32] },
            MAX_CAPABILITY_BIT + 1,
            vec![],
        );
        assert!(p.validate().is_err());
    }

    #[test]
    fn task_payload_validate_accepts_max_criteria() {
        let p = TaskPayload::new(
            TaskKind::Generic { capability_bit: 0, args_hash: [0u8; 32] },
            MAX_CAPABILITY_BIT,
            vec![0u8; MAX_CRITERIA_LEN],
        );
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
    fn hook_gate_active_skips_when_pointer_zero() {
        let ok = hook_gate_active(&Pubkey::default(), None).unwrap();
        assert!(!ok);
    }

    #[test]
    fn hook_gate_active_requires_account_when_wired() {
        let ptr = Pubkey::new_from_array([7u8; 32]);
        assert!(hook_gate_active(&ptr, None).is_err());
    }

    #[test]
    fn hook_gate_active_rejects_mismatched_account() {
        let ptr = Pubkey::new_from_array([7u8; 32]);
        let wrong = Pubkey::new_from_array([8u8; 32]);
        assert!(hook_gate_active(&ptr, Some(&wrong)).is_err());
    }

    #[test]
    fn hook_gate_active_accepts_matched_account() {
        let ptr = Pubkey::new_from_array([7u8; 32]);
        assert!(hook_gate_active(&ptr, Some(&ptr)).unwrap());
    }

    #[test]
    fn mint_accept_flags_all_set_when_clean() {
        use fee_collector::{
            MINT_FLAG_ALL, MINT_FLAG_HOOK_OK, MINT_FLAG_NO_FROZEN_DEFAULT,
            MINT_FLAG_NO_PERMANENT_DELEGATE, MINT_FLAG_NO_TRANSFER_FEE,
        };
        let expected = MINT_FLAG_NO_TRANSFER_FEE
            | MINT_FLAG_NO_FROZEN_DEFAULT
            | MINT_FLAG_NO_PERMANENT_DELEGATE
            | MINT_FLAG_HOOK_OK;
        assert_eq!(expected, MINT_FLAG_ALL);
    }

    // Mirrors allow_payment_mint's flag-building decision tree. Kept here so
    // the bitfield contract is exercised without spinning up a full Anchor harness.
    fn build_flags(
        has_transfer_fee_ext: bool,
        fee_authority_is_governance: bool,
        default_frozen: bool,
        permanent_delegate: bool,
        hook_program: Option<Pubkey>,
        hook_on_allowlist: bool,
    ) -> Option<u32> {
        use fee_collector::{
            MINT_FLAG_HOOK_OK, MINT_FLAG_NO_FROZEN_DEFAULT, MINT_FLAG_NO_PERMANENT_DELEGATE,
            MINT_FLAG_NO_TRANSFER_FEE,
        };
        let mut f = 0u32;
        if has_transfer_fee_ext && !fee_authority_is_governance {
            return None;
        }
        f |= MINT_FLAG_NO_TRANSFER_FEE;

        if default_frozen {
            return None;
        }
        f |= MINT_FLAG_NO_FROZEN_DEFAULT;

        if permanent_delegate {
            return None;
        }
        f |= MINT_FLAG_NO_PERMANENT_DELEGATE;

        if let Some(_pid) = hook_program {
            if !hook_on_allowlist {
                return None;
            }
        }
        f |= MINT_FLAG_HOOK_OK;
        Some(f)
    }

    #[test]
    fn mint_accept_clean_mint_accepted() {
        let f = build_flags(false, false, false, false, None, false);
        assert_eq!(f, Some(fee_collector::MINT_FLAG_ALL));
    }

    #[test]
    fn mint_accept_rejects_non_governance_transfer_fee() {
        assert!(build_flags(true, false, false, false, None, false).is_none());
    }

    #[test]
    fn mint_accept_accepts_governance_transfer_fee() {
        assert_eq!(
            build_flags(true, true, false, false, None, false),
            Some(fee_collector::MINT_FLAG_ALL)
        );
    }

    #[test]
    fn mint_accept_rejects_default_frozen() {
        assert!(build_flags(false, false, true, false, None, false).is_none());
    }

    #[test]
    fn mint_accept_rejects_permanent_delegate() {
        assert!(build_flags(false, false, false, true, None, false).is_none());
    }

    #[test]
    fn mint_accept_rejects_unlisted_hook() {
        let pid = Pubkey::new_from_array([9u8; 32]);
        assert!(build_flags(false, false, false, false, Some(pid), false).is_none());
    }

    #[test]
    fn mint_accept_accepts_listed_hook() {
        let pid = Pubkey::new_from_array([9u8; 32]);
        assert_eq!(
            build_flags(false, false, false, false, Some(pid), true),
            Some(fee_collector::MINT_FLAG_ALL)
        );
    }

    #[test]
    fn mint_accept_flags_individually_distinct() {
        use fee_collector::{
            MINT_FLAG_HOOK_OK, MINT_FLAG_NO_FROZEN_DEFAULT, MINT_FLAG_NO_PERMANENT_DELEGATE,
            MINT_FLAG_NO_TRANSFER_FEE,
        };
        let bits = [
            MINT_FLAG_NO_TRANSFER_FEE,
            MINT_FLAG_NO_FROZEN_DEFAULT,
            MINT_FLAG_NO_PERMANENT_DELEGATE,
            MINT_FLAG_HOOK_OK,
        ];
        for i in 0..bits.len() {
            for j in (i + 1)..bits.len() {
                assert_ne!(bits[i], bits[j]);
            }
            assert_eq!(bits[i].count_ones(), 1);
        }
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

    #[test]
    fn task_payload_default_requires_personhood_is_none() {
        let p = payload_with_kind(
            TaskKind::Generic { capability_bit: 0, args_hash: [0u8; 32] },
            0,
        );
        assert_eq!(p.requires_personhood, PersonhoodTier::None);
    }

    #[test]
    fn task_payload_hash_binds_personhood_tier() {
        let a = payload_with_kind(
            TaskKind::Generic { capability_bit: 1, args_hash: [1u8; 32] },
            1,
        );
        let b = payload_with_personhood(
            TaskKind::Generic { capability_bit: 1, args_hash: [1u8; 32] },
            1,
            PersonhoodTier::Basic,
        );
        assert_ne!(a.hash().unwrap(), b.hash().unwrap());
    }

    #[test]
    fn task_payload_roundtrip_preserves_personhood_tier() {
        let p = payload_with_personhood(
            TaskKind::Transfer {
                mint: Pubkey::new_from_array([3u8; 32]),
                to: Pubkey::new_from_array([4u8; 32]),
                amount: 1,
            },
            1,
            PersonhoodTier::Verified,
        );
        let bytes = serialize(&p);
        let decoded = TaskPayload::try_from_slice(&bytes).unwrap();
        assert_eq!(decoded.requires_personhood, PersonhoodTier::Verified);
        assert_eq!(decoded, p);
    }

    // F-2026-08: commit_bid enforces `capability_mask & (1 << capability_bit)`.
    fn cap_bit_satisfied(mask: u128, bit: u16) -> bool {
        (mask & (1u128 << (bit as u32))) != 0
    }

    #[test]
    fn capability_bit_check_rejects_missing_bit() {
        // mask advertises bits 0 and 5, not bit 3.
        let mask: u128 = (1 << 0) | (1 << 5);
        assert!(!cap_bit_satisfied(mask, 3));
    }

    #[test]
    fn capability_bit_check_accepts_present_bit() {
        let mask: u128 = (1 << 7) | (1 << 42);
        assert!(cap_bit_satisfied(mask, 7));
        assert!(cap_bit_satisfied(mask, 42));
    }

    #[test]
    fn capability_bit_check_boundary_bit_127() {
        let mask: u128 = 1u128 << 127;
        assert!(cap_bit_satisfied(mask, 127));
        assert!(!cap_bit_satisfied(mask, 126));
    }

    // F-2026-07: close_bidding must receive exactly `reveal_count * 2` accounts.
    fn enumeration_matches(reveal_count: u16, remaining_len: usize) -> bool {
        remaining_len % 2 == 0 && remaining_len == (reveal_count as usize) * 2
    }

    #[test]
    fn enumeration_accepts_exact_count() {
        assert!(enumeration_matches(3, 6));
    }

    #[test]
    fn enumeration_rejects_partial_submission() {
        assert!(!enumeration_matches(3, 4));
    }

    #[test]
    fn enumeration_rejects_padded_submission() {
        assert!(!enumeration_matches(2, 6));
    }

    #[test]
    fn enumeration_rejects_odd_total() {
        assert!(!enumeration_matches(2, 5));
    }

    fn is_duplicate(seen: &[Pubkey], candidate: &Pubkey) -> bool {
        seen.iter().any(|b| b == candidate)
    }

    #[test]
    fn duplicate_bidder_detected() {
        let a = Pubkey::new_from_array([1u8; 32]);
        let b = Pubkey::new_from_array([2u8; 32]);
        let seen = vec![a, b];
        assert!(is_duplicate(&seen, &a));
        assert!(!is_duplicate(&seen, &Pubkey::new_from_array([3u8; 32])));
    }
}

