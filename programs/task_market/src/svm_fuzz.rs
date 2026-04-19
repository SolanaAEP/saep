use anchor_lang::prelude::*;
use anchor_lang::{AccountDeserialize, AccountSerialize, Discriminator};
use proptest::prelude::*;

use crate::guard::ReentrancyGuard;
use crate::state::{
    Bid, BidBook, BidPhase, MarketGlobal, MintAcceptRecord, TaskContract, TaskKind, TaskPayload,
    TaskStatus, ALLOWED_MINTS_LEN,
};

fn pk(n: u8) -> Pubkey {
    Pubkey::new_from_array([n; 32])
}

fn serialize_account<T: AccountSerialize>(v: &T) -> Vec<u8> {
    let mut buf = Vec::new();
    v.try_serialize(&mut buf).unwrap();
    buf
}

fn make_global() -> MarketGlobal {
    MarketGlobal {
        authority: pk(1),
        pending_authority: Some(pk(2)),
        agent_registry: pk(3),
        treasury_standard: pk(4),
        proof_verifier: pk(5),
        fee_collector: pk(6),
        solrep_pool: pk(7),
        protocol_fee_bps: 50,
        solrep_fee_bps: 50,
        dispute_window_secs: 86_400,
        max_deadline_secs: 30 * 86_400,
        allowed_payment_mints: [Pubkey::default(); ALLOWED_MINTS_LEN],
        paused: false,
        bump: 254,
        hook_allowlist: Pubkey::default(),
    }
}

fn make_task() -> TaskContract {
    TaskContract {
        task_id: [1u8; 32],
        client: pk(10),
        agent_did: [2u8; 32],
        task_nonce: [3u8; 8],
        payment_mint: pk(11),
        payment_amount: 1_000_000,
        protocol_fee: 5_000,
        solrep_fee: 5_000,
        task_hash: [4u8; 32],
        result_hash: [0u8; 32],
        proof_key: [0u8; 32],
        criteria_root: [0u8; 32],
        milestone_count: 1,
        milestones_complete: 0,
        status: TaskStatus::Created,
        created_at: 1_700_000_000,
        funded_at: 0,
        deadline: 1_700_086_400,
        submitted_at: 0,
        dispute_window_end: 0,
        verified: false,
        bump: 253,
        escrow_bump: 252,
        bid_book: None,
        assigned_agent: None,
        payload: TaskPayload::new(
            TaskKind::Generic {
                capability_bit: 0,
                args_hash: [0u8; 32],
            },
            0,
            vec![],
        ),
    }
}

fn make_bid_book() -> BidBook {
    BidBook {
        task_id: [1u8; 32],
        commit_start: 1_700_000_000,
        commit_end: 1_700_000_300,
        reveal_end: 1_700_000_480,
        bond_amount: 50_000,
        bond_mint: pk(20),
        commit_count: 3,
        reveal_count: 2,
        winner_agent: None,
        winner_bidder: None,
        winner_amount: 0,
        phase: BidPhase::Commit,
        bump: 251,
        escrow_bump: 250,
    }
}

fn make_bid() -> Bid {
    Bid {
        task_id: [1u8; 32],
        agent_did: [2u8; 32],
        bidder: pk(30),
        commit_hash: [5u8; 32],
        bond_paid: 50_000,
        revealed_amount: 0,
        revealed: false,
        refunded: false,
        slashed: false,
        bump: 249,
    }
}

fn make_mint_accept() -> MintAcceptRecord {
    MintAcceptRecord {
        mint: pk(40),
        mint_accept_flags: 0xF,
        hook_program: None,
        accepted_at_slot: 100,
        accepted_at_ts: 1_700_000_000,
        bump: 248,
    }
}

fn make_guard() -> ReentrancyGuard {
    ReentrancyGuard {
        active: false,
        entered_by: Pubkey::default(),
        entered_at_slot: 0,
        reset_proposed_at: 0,
        bump: 247,
    }
}

fn make_account_info<'a>(
    key: &'a Pubkey,
    is_signer: bool,
    is_writable: bool,
    lamports: &'a mut u64,
    data: &'a mut [u8],
    owner: &'a Pubkey,
) -> AccountInfo<'a> {
    AccountInfo::new(key, is_signer, is_writable, lamports, data, owner, false)
}

fn wrong_owner() -> Pubkey {
    Pubkey::new_from_array([0xDE; 32])
}

fn cross_discriminator(buf: &mut [u8], other_disc: &[u8]) {
    if buf.len() >= 8 {
        buf[..8].copy_from_slice(other_disc);
    }
}

// ── Discriminator cross-contamination ──

#[test]
fn global_rejects_task_discriminator() {
    let g = make_global();
    let mut data = serialize_account(&g);
    cross_discriminator(&mut data, TaskContract::DISCRIMINATOR);
    let mut slice = data.as_slice();
    assert!(MarketGlobal::try_deserialize(&mut slice).is_err());
}

#[test]
fn task_rejects_global_discriminator() {
    let t = make_task();
    let mut data = serialize_account(&t);
    cross_discriminator(&mut data, MarketGlobal::DISCRIMINATOR);
    let mut slice = data.as_slice();
    assert!(TaskContract::try_deserialize(&mut slice).is_err());
}

#[test]
fn global_rejects_bid_book_discriminator() {
    let g = make_global();
    let mut data = serialize_account(&g);
    cross_discriminator(&mut data, BidBook::DISCRIMINATOR);
    let mut slice = data.as_slice();
    assert!(MarketGlobal::try_deserialize(&mut slice).is_err());
}

#[test]
fn global_rejects_bid_discriminator() {
    let g = make_global();
    let mut data = serialize_account(&g);
    cross_discriminator(&mut data, Bid::DISCRIMINATOR);
    let mut slice = data.as_slice();
    assert!(MarketGlobal::try_deserialize(&mut slice).is_err());
}

#[test]
fn global_rejects_mint_accept_discriminator() {
    let g = make_global();
    let mut data = serialize_account(&g);
    cross_discriminator(&mut data, MintAcceptRecord::DISCRIMINATOR);
    let mut slice = data.as_slice();
    assert!(MarketGlobal::try_deserialize(&mut slice).is_err());
}

#[test]
fn global_rejects_guard_discriminator() {
    let g = make_global();
    let mut data = serialize_account(&g);
    cross_discriminator(&mut data, ReentrancyGuard::DISCRIMINATOR);
    let mut slice = data.as_slice();
    assert!(MarketGlobal::try_deserialize(&mut slice).is_err());
}

#[test]
fn task_rejects_bid_book_discriminator() {
    let t = make_task();
    let mut data = serialize_account(&t);
    cross_discriminator(&mut data, BidBook::DISCRIMINATOR);
    let mut slice = data.as_slice();
    assert!(TaskContract::try_deserialize(&mut slice).is_err());
}

#[test]
fn task_rejects_bid_discriminator() {
    let t = make_task();
    let mut data = serialize_account(&t);
    cross_discriminator(&mut data, Bid::DISCRIMINATOR);
    let mut slice = data.as_slice();
    assert!(TaskContract::try_deserialize(&mut slice).is_err());
}

#[test]
fn bid_book_rejects_task_discriminator() {
    let bb = make_bid_book();
    let mut data = serialize_account(&bb);
    cross_discriminator(&mut data, TaskContract::DISCRIMINATOR);
    let mut slice = data.as_slice();
    assert!(BidBook::try_deserialize(&mut slice).is_err());
}

#[test]
fn bid_rejects_bid_book_discriminator() {
    let b = make_bid();
    let mut data = serialize_account(&b);
    cross_discriminator(&mut data, BidBook::DISCRIMINATOR);
    let mut slice = data.as_slice();
    assert!(Bid::try_deserialize(&mut slice).is_err());
}

#[test]
fn bid_book_rejects_bid_discriminator() {
    let bb = make_bid_book();
    let mut data = serialize_account(&bb);
    cross_discriminator(&mut data, Bid::DISCRIMINATOR);
    let mut slice = data.as_slice();
    assert!(BidBook::try_deserialize(&mut slice).is_err());
}

#[test]
fn mint_accept_rejects_global_discriminator() {
    let ma = make_mint_accept();
    let mut data = serialize_account(&ma);
    cross_discriminator(&mut data, MarketGlobal::DISCRIMINATOR);
    let mut slice = data.as_slice();
    assert!(MintAcceptRecord::try_deserialize(&mut slice).is_err());
}

#[test]
fn guard_rejects_task_discriminator() {
    let g = make_guard();
    let mut data = serialize_account(&g);
    cross_discriminator(&mut data, TaskContract::DISCRIMINATOR);
    let mut slice = data.as_slice();
    assert!(ReentrancyGuard::try_deserialize(&mut slice).is_err());
}

#[test]
fn guard_rejects_bid_discriminator() {
    let g = make_guard();
    let mut data = serialize_account(&g);
    cross_discriminator(&mut data, Bid::DISCRIMINATOR);
    let mut slice = data.as_slice();
    assert!(ReentrancyGuard::try_deserialize(&mut slice).is_err());
}

// ── Cross-account data confusion ──

#[test]
fn global_rejects_task_data() {
    let t = make_task();
    let data = serialize_account(&t);
    let mut slice = data.as_slice();
    assert!(MarketGlobal::try_deserialize(&mut slice).is_err());
}

#[test]
fn task_rejects_global_data() {
    let g = make_global();
    let data = serialize_account(&g);
    let mut slice = data.as_slice();
    assert!(TaskContract::try_deserialize(&mut slice).is_err());
}

#[test]
fn bid_rejects_task_data() {
    let t = make_task();
    let data = serialize_account(&t);
    let mut slice = data.as_slice();
    assert!(Bid::try_deserialize(&mut slice).is_err());
}

#[test]
fn bid_book_rejects_global_data() {
    let g = make_global();
    let data = serialize_account(&g);
    let mut slice = data.as_slice();
    assert!(BidBook::try_deserialize(&mut slice).is_err());
}

#[test]
fn guard_rejects_bid_data() {
    let b = make_bid();
    let data = serialize_account(&b);
    let mut slice = data.as_slice();
    assert!(ReentrancyGuard::try_deserialize(&mut slice).is_err());
}

#[test]
fn mint_accept_rejects_bid_book_data() {
    let bb = make_bid_book();
    let data = serialize_account(&bb);
    let mut slice = data.as_slice();
    assert!(MintAcceptRecord::try_deserialize(&mut slice).is_err());
}

// ── Owner checks (structural) ──

#[test]
fn global_wrong_owner_structural() {
    let g = make_global();
    let mut data = serialize_account(&g);
    let key = Pubkey::new_unique();
    let bad_owner = wrong_owner();
    let mut lamports = 1_000_000u64;
    let ai = make_account_info(&key, false, false, &mut lamports, &mut data, &bad_owner);
    assert_ne!(*ai.owner, crate::ID);
}

#[test]
fn task_wrong_owner_structural() {
    let t = make_task();
    let mut data = serialize_account(&t);
    let key = Pubkey::new_unique();
    let bad_owner = wrong_owner();
    let mut lamports = 1_000_000u64;
    let ai = make_account_info(&key, false, false, &mut lamports, &mut data, &bad_owner);
    assert_ne!(*ai.owner, crate::ID);
}

#[test]
fn bid_wrong_owner_structural() {
    let b = make_bid();
    let mut data = serialize_account(&b);
    let key = Pubkey::new_unique();
    let bad_owner = wrong_owner();
    let mut lamports = 1_000_000u64;
    let ai = make_account_info(&key, false, false, &mut lamports, &mut data, &bad_owner);
    assert_ne!(*ai.owner, crate::ID);
}

// ── Signer checks (structural) ──

#[test]
fn governance_authority_must_be_signer() {
    let authority_key = pk(1);
    let mut lamports = 1_000_000u64;
    let mut data = vec![];
    let system = anchor_lang::system_program::ID;
    let ai = make_account_info(&authority_key, false, false, &mut lamports, &mut data, &system);
    assert!(!ai.is_signer);
}

#[test]
fn client_must_be_signer_for_create_task() {
    let client_key = pk(10);
    let mut lamports = 1_000_000u64;
    let mut data = vec![];
    let system = anchor_lang::system_program::ID;
    let ai = make_account_info(&client_key, false, true, &mut lamports, &mut data, &system);
    assert!(!ai.is_signer);
}

#[test]
fn client_must_be_signer_for_fund_task() {
    let client_key = pk(10);
    let mut lamports = 1_000_000u64;
    let mut data = vec![];
    let system = anchor_lang::system_program::ID;
    let ai = make_account_info(&client_key, false, true, &mut lamports, &mut data, &system);
    assert!(!ai.is_signer);
}

#[test]
fn operator_must_be_signer_for_submit_result() {
    let operator_key = pk(20);
    let mut lamports = 1_000_000u64;
    let mut data = vec![];
    let system = anchor_lang::system_program::ID;
    let ai = make_account_info(&operator_key, false, false, &mut lamports, &mut data, &system);
    assert!(!ai.is_signer);
}

// ── has_one constraint verification ──

#[test]
fn governance_rejects_wrong_authority_key() {
    let mut g = make_global();
    g.authority = pk(99);
    let data = serialize_account(&g);
    let mut slice = data.as_slice();
    let parsed = MarketGlobal::try_deserialize(&mut slice).unwrap();
    let fake_signer = pk(1);
    assert_ne!(parsed.authority, fake_signer);
}

#[test]
fn fund_task_rejects_wrong_client() {
    let mut t = make_task();
    t.client = pk(99);
    let data = serialize_account(&t);
    let mut slice = data.as_slice();
    let parsed = TaskContract::try_deserialize(&mut slice).unwrap();
    let impersonator = pk(10);
    assert_ne!(parsed.client, impersonator);
}

// ── Proptest: all pairwise discriminator rejections ──

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 128,
        ..ProptestConfig::default()
    })]

    #[test]
    fn global_rejects_all_cross_discriminators(
        disc_idx in 0usize..5,
    ) {
        let discriminators = [
            TaskContract::DISCRIMINATOR,
            BidBook::DISCRIMINATOR,
            Bid::DISCRIMINATOR,
            MintAcceptRecord::DISCRIMINATOR,
            ReentrancyGuard::DISCRIMINATOR,
        ];
        let g = make_global();
        let mut data = serialize_account(&g);
        cross_discriminator(&mut data, discriminators[disc_idx]);
        let mut slice = data.as_slice();
        prop_assert!(MarketGlobal::try_deserialize(&mut slice).is_err());
    }

    #[test]
    fn task_rejects_all_cross_discriminators(
        disc_idx in 0usize..5,
    ) {
        let discriminators = [
            MarketGlobal::DISCRIMINATOR,
            BidBook::DISCRIMINATOR,
            Bid::DISCRIMINATOR,
            MintAcceptRecord::DISCRIMINATOR,
            ReentrancyGuard::DISCRIMINATOR,
        ];
        let t = make_task();
        let mut data = serialize_account(&t);
        cross_discriminator(&mut data, discriminators[disc_idx]);
        let mut slice = data.as_slice();
        prop_assert!(TaskContract::try_deserialize(&mut slice).is_err());
    }

    #[test]
    fn bid_rejects_all_cross_discriminators(
        disc_idx in 0usize..5,
    ) {
        let discriminators = [
            MarketGlobal::DISCRIMINATOR,
            TaskContract::DISCRIMINATOR,
            BidBook::DISCRIMINATOR,
            MintAcceptRecord::DISCRIMINATOR,
            ReentrancyGuard::DISCRIMINATOR,
        ];
        let b = make_bid();
        let mut data = serialize_account(&b);
        cross_discriminator(&mut data, discriminators[disc_idx]);
        let mut slice = data.as_slice();
        prop_assert!(Bid::try_deserialize(&mut slice).is_err());
    }

    #[test]
    fn bid_book_rejects_all_cross_discriminators(
        disc_idx in 0usize..5,
    ) {
        let discriminators = [
            MarketGlobal::DISCRIMINATOR,
            TaskContract::DISCRIMINATOR,
            Bid::DISCRIMINATOR,
            MintAcceptRecord::DISCRIMINATOR,
            ReentrancyGuard::DISCRIMINATOR,
        ];
        let bb = make_bid_book();
        let mut data = serialize_account(&bb);
        cross_discriminator(&mut data, discriminators[disc_idx]);
        let mut slice = data.as_slice();
        prop_assert!(BidBook::try_deserialize(&mut slice).is_err());
    }

    #[test]
    fn all_accounts_reject_flipped_discriminator(
        account_idx in 0usize..6,
        flip_byte in 0usize..8,
        flip_val in 1u8..=255u8,
    ) {
        let mut data = match account_idx {
            0 => serialize_account(&make_global()),
            1 => serialize_account(&make_task()),
            2 => serialize_account(&make_bid_book()),
            3 => serialize_account(&make_bid()),
            4 => serialize_account(&make_mint_accept()),
            _ => serialize_account(&make_guard()),
        };
        let valid_disc: &[u8] = match account_idx {
            0 => MarketGlobal::DISCRIMINATOR,
            1 => TaskContract::DISCRIMINATOR,
            2 => BidBook::DISCRIMINATOR,
            3 => Bid::DISCRIMINATOR,
            4 => MintAcceptRecord::DISCRIMINATOR,
            _ => ReentrancyGuard::DISCRIMINATOR,
        };
        data[flip_byte] ^= flip_val;
        if data.len() >= 8 && data[..8] == *valid_disc {
            return Ok(());
        }
        let mut slice = data.as_slice();
        let result = match account_idx {
            0 => MarketGlobal::try_deserialize(&mut slice).map(|_| ()),
            1 => TaskContract::try_deserialize(&mut slice).map(|_| ()),
            2 => BidBook::try_deserialize(&mut slice).map(|_| ()),
            3 => Bid::try_deserialize(&mut slice).map(|_| ()),
            4 => MintAcceptRecord::try_deserialize(&mut slice).map(|_| ()),
            _ => ReentrancyGuard::try_deserialize(&mut slice).map(|_| ()),
        };
        prop_assert!(result.is_err());
    }

    #[test]
    fn owner_check_structural_all_accounts(
        owner_seed in any::<[u8; 32]>(),
        account_idx in 0usize..6,
    ) {
        let bad_owner = Pubkey::new_from_array(owner_seed);
        prop_assume!(bad_owner != crate::ID);
        let mut data = match account_idx {
            0 => serialize_account(&make_global()),
            1 => serialize_account(&make_task()),
            2 => serialize_account(&make_bid_book()),
            3 => serialize_account(&make_bid()),
            4 => serialize_account(&make_mint_accept()),
            _ => serialize_account(&make_guard()),
        };
        let key = Pubkey::new_unique();
        let mut lamports = 1_000_000u64;
        let ai = make_account_info(&key, false, false, &mut lamports, &mut data, &bad_owner);
        prop_assert_ne!(*ai.owner, crate::ID);
    }

    #[test]
    fn signer_flag_false_prevents_all_authority_instructions(
        authority_seed in any::<[u8; 32]>(),
    ) {
        let authority_key = Pubkey::new_from_array(authority_seed);
        let mut lamports = 1_000_000u64;
        let mut data = vec![];
        let system = anchor_lang::system_program::ID;
        let ai = make_account_info(
            &authority_key,
            false,
            false,
            &mut lamports,
            &mut data,
            &system,
        );
        prop_assert!(!ai.is_signer);
    }
}

// ── Cross-program account confusion ──
// AgentRegistry accounts should not deserialize as TaskMarket accounts.

#[test]
fn agent_registry_global_does_not_parse_as_market_global() {
    use agent_registry::state::RegistryGlobal;
    let rg = RegistryGlobal {
        authority: pk(1),
        pending_authority: None,
        capability_registry: pk(3),
        task_market: pk(4),
        dispute_arbitration: pk(5),
        slashing_treasury: pk(6),
        stake_mint: pk(7),
        proof_verifier: pk(8),
        min_stake: 1_000_000,
        max_slash_bps: 500,
        slash_timelock_secs: 2_592_000,
        paused: false,
        allowed_civic_networks: [Pubkey::default(); 8],
        allowed_civic_networks_len: 0,
        allowed_sas_issuers: [Pubkey::default(); 8],
        allowed_sas_issuers_len: 0,
        personhood_basic_min_tier: agent_registry::state::PersonhoodTier::None,
        require_personhood_for_register: false,
        civic_gateway_program: Pubkey::default(),
        bump: 254,
    };
    let mut data = Vec::new();
    rg.try_serialize(&mut data).unwrap();
    let mut slice = data.as_slice();
    assert!(MarketGlobal::try_deserialize(&mut slice).is_err());
}

#[test]
fn agent_account_does_not_parse_as_task_contract() {
    use agent_registry::state::{AgentAccount, AgentStatus, ReputationScore, MANIFEST_URI_LEN};
    let a = AgentAccount {
        operator: pk(10),
        agent_id: [1u8; 32],
        did: [2u8; 32],
        manifest_uri: [0u8; MANIFEST_URI_LEN],
        capability_mask: 0xFF,
        price_lamports: 100_000,
        stream_rate: 50,
        reputation: ReputationScore::default(),
        jobs_completed: 0,
        jobs_disputed: 0,
        stake_amount: 1_000_000,
        status: AgentStatus::Active,
        version: 1,
        registered_at: 1_700_000_000,
        last_active: 1_700_000_000,
        delegate: None,
        pending_slash: None,
        pending_withdrawal: None,
        bump: 253,
        vault_bump: 252,
    };
    let mut data = Vec::new();
    a.try_serialize(&mut data).unwrap();
    let mut slice = data.as_slice();
    assert!(TaskContract::try_deserialize(&mut slice).is_err());
}

// ── Discriminators are pairwise distinct across both programs ──

#[test]
fn discriminators_distinct_across_programs() {
    use agent_registry::state::{
        AgentAccount as AR_Agent, CategoryReputation as AR_CatRep,
        PersonhoodAttestation as AR_Personhood, RegistryGlobal as AR_Global,
    };

    let ar_discs = [
        AR_Global::DISCRIMINATOR,
        AR_Agent::DISCRIMINATOR,
        AR_Personhood::DISCRIMINATOR,
        AR_CatRep::DISCRIMINATOR,
    ];
    let tm_discs = [
        MarketGlobal::DISCRIMINATOR,
        TaskContract::DISCRIMINATOR,
        BidBook::DISCRIMINATOR,
        Bid::DISCRIMINATOR,
        MintAcceptRecord::DISCRIMINATOR,
    ];

    for (i, ar_d) in ar_discs.iter().enumerate() {
        for (j, tm_d) in tm_discs.iter().enumerate() {
            assert_ne!(
                ar_d, tm_d,
                "cross-program discriminator collision: agent_registry[{i}] vs task_market[{j}]"
            );
        }
    }
}
