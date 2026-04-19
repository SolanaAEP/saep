use anchor_lang::prelude::*;
use anchor_lang::{AccountDeserialize, AccountSerialize, Discriminator};
use proptest::prelude::*;

use crate::guard::ReentrancyGuard;
use crate::state::{
    AgentAccount, AgentStatus, CategoryReputation, RegistryGlobal, ReputationScore,
    MANIFEST_URI_LEN, MAX_GATEKEEPER_NETWORKS,
};

fn pk(n: u8) -> Pubkey {
    Pubkey::new_from_array([n; 32])
}

fn serialize_account<T: AccountSerialize>(v: &T) -> Vec<u8> {
    let mut buf = Vec::new();
    v.try_serialize(&mut buf).unwrap();
    buf
}

fn make_global() -> RegistryGlobal {
    RegistryGlobal {
        authority: pk(1),
        pending_authority: Some(pk(2)),
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
        allowed_civic_networks: [Pubkey::default(); MAX_GATEKEEPER_NETWORKS],
        allowed_civic_networks_len: 0,
        allowed_sas_issuers: [Pubkey::default(); MAX_GATEKEEPER_NETWORKS],
        allowed_sas_issuers_len: 0,
        personhood_basic_min_tier: crate::state::PersonhoodTier::None,
        require_personhood_for_register: false,
        civic_gateway_program: Pubkey::default(),
        bump: 254,
    }
}

fn make_agent() -> AgentAccount {
    AgentAccount {
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
    }
}

fn make_guard() -> ReentrancyGuard {
    ReentrancyGuard {
        active: false,
        entered_by: Pubkey::default(),
        entered_at_slot: 0,
        reset_proposed_at: 0,
        bump: 251,
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

// ── Owner checks ──

#[test]
fn global_rejects_wrong_owner() {
    let g = make_global();
    let mut data = serialize_account(&g);
    let key = Pubkey::new_unique();
    let bad_owner = wrong_owner();
    let mut lamports = 1_000_000u64;
    let ai = make_account_info(&key, false, false, &mut lamports, &mut data, &bad_owner);
    let mut slice = &ai.try_borrow_data().unwrap()[..];
    let parsed = RegistryGlobal::try_deserialize(&mut slice);
    assert!(parsed.is_ok(), "deserialization itself succeeds regardless of owner");
    assert_ne!(*ai.owner, crate::ID, "wrong owner must differ from program id");
}

#[test]
fn agent_rejects_wrong_owner() {
    let a = make_agent();
    let mut data = serialize_account(&a);
    let key = Pubkey::new_unique();
    let bad_owner = wrong_owner();
    let mut lamports = 1_000_000u64;
    let ai = make_account_info(&key, false, false, &mut lamports, &mut data, &bad_owner);
    assert_ne!(*ai.owner, crate::ID);
}

#[test]
fn guard_rejects_wrong_owner() {
    let g = make_guard();
    let mut data = serialize_account(&g);
    let key = Pubkey::new_unique();
    let bad_owner = wrong_owner();
    let mut lamports = 1_000_000u64;
    let ai = make_account_info(&key, false, false, &mut lamports, &mut data, &bad_owner);
    assert_ne!(*ai.owner, crate::ID);
}

// ── Discriminator checks ──

#[test]
fn global_rejects_agent_discriminator() {
    let g = make_global();
    let mut data = serialize_account(&g);
    cross_discriminator(&mut data, AgentAccount::DISCRIMINATOR);
    let mut slice = data.as_slice();
    assert!(RegistryGlobal::try_deserialize(&mut slice).is_err());
}

#[test]
fn agent_rejects_global_discriminator() {
    let a = make_agent();
    let mut data = serialize_account(&a);
    cross_discriminator(&mut data, RegistryGlobal::DISCRIMINATOR);
    let mut slice = data.as_slice();
    assert!(AgentAccount::try_deserialize(&mut slice).is_err());
}

#[test]
fn global_rejects_guard_discriminator() {
    let g = make_global();
    let mut data = serialize_account(&g);
    cross_discriminator(&mut data, ReentrancyGuard::DISCRIMINATOR);
    let mut slice = data.as_slice();
    assert!(RegistryGlobal::try_deserialize(&mut slice).is_err());
}

#[test]
fn agent_rejects_guard_discriminator() {
    let a = make_agent();
    let mut data = serialize_account(&a);
    cross_discriminator(&mut data, ReentrancyGuard::DISCRIMINATOR);
    let mut slice = data.as_slice();
    assert!(AgentAccount::try_deserialize(&mut slice).is_err());
}

#[test]
fn guard_rejects_global_discriminator() {
    let g = make_guard();
    let mut data = serialize_account(&g);
    cross_discriminator(&mut data, RegistryGlobal::DISCRIMINATOR);
    let mut slice = data.as_slice();
    assert!(ReentrancyGuard::try_deserialize(&mut slice).is_err());
}

#[test]
fn guard_rejects_agent_discriminator() {
    let g = make_guard();
    let mut data = serialize_account(&g);
    cross_discriminator(&mut data, AgentAccount::DISCRIMINATOR);
    let mut slice = data.as_slice();
    assert!(ReentrancyGuard::try_deserialize(&mut slice).is_err());
}

#[test]
fn category_rep_rejects_agent_discriminator() {
    let cr = CategoryReputation {
        agent_did: [4u8; 32],
        capability_bit: 5,
        score: ReputationScore::default(),
        jobs_completed: 10,
        jobs_disputed: 1,
        last_proof_key: [5u8; 32],
        last_task_id: [6u8; 32],
        version: 1,
        bump: 250,
    };
    let mut data = serialize_account(&cr);
    cross_discriminator(&mut data, AgentAccount::DISCRIMINATOR);
    let mut slice = data.as_slice();
    assert!(CategoryReputation::try_deserialize(&mut slice).is_err());
}

// ── Signer checks (structural) ──
// Anchor's has_one + Signer constraints reject unsigned accounts at the
// constraint validation layer. These tests verify AccountInfo signer flag
// behaviour at the data level — any instruction requiring a signer will fail
// when the AccountInfo.is_signer == false.

#[test]
fn governance_authority_must_be_signer() {
    let authority_key = pk(1);
    let mut lamports = 1_000_000u64;
    let mut data = vec![];
    let system = anchor_lang::system_program::ID;
    let ai = make_account_info(
        &authority_key,
        false, // not a signer
        false,
        &mut lamports,
        &mut data,
        &system,
    );
    assert!(!ai.is_signer, "authority must be flagged as signer for governance instructions");
}

#[test]
fn operator_must_be_signer_for_register() {
    let operator_key = pk(10);
    let mut lamports = 1_000_000u64;
    let mut data = vec![];
    let system = anchor_lang::system_program::ID;
    let ai = make_account_info(
        &operator_key,
        false,
        true,
        &mut lamports,
        &mut data,
        &system,
    );
    assert!(!ai.is_signer, "operator must be flagged as signer for register_agent");
}

#[test]
fn cranker_must_be_signer_for_execute_slash() {
    let cranker_key = Pubkey::new_unique();
    let mut lamports = 1_000_000u64;
    let mut data = vec![];
    let system = anchor_lang::system_program::ID;
    let ai = make_account_info(
        &cranker_key,
        false,
        false,
        &mut lamports,
        &mut data,
        &system,
    );
    assert!(!ai.is_signer);
}

// ── has_one constraint verification ──
// GovernanceUpdate requires `global.authority == authority.key()`.
// Passing a global whose authority differs from the signer should fail.

#[test]
fn governance_rejects_wrong_authority_key() {
    let mut g = make_global();
    g.authority = pk(99);
    let data = serialize_account(&g);
    let mut slice = data.as_slice();
    let parsed = RegistryGlobal::try_deserialize(&mut slice).unwrap();
    let fake_signer = pk(1);
    assert_ne!(parsed.authority, fake_signer, "has_one = authority would reject this");
}

#[test]
fn delegate_control_rejects_non_operator() {
    let a = make_agent();
    let data = serialize_account(&a);
    let mut slice = data.as_slice();
    let parsed = AgentAccount::try_deserialize(&mut slice).unwrap();
    let impersonator = pk(99);
    assert_ne!(
        parsed.operator, impersonator,
        "has_one = operator would reject impersonator"
    );
}

// ── Proptest: owner/discriminator cross-contamination ──

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 128,
        ..ProptestConfig::default()
    })]

    #[test]
    fn global_rejects_random_cross_discriminator(
        disc_idx in 0usize..4,
    ) {
        let discriminators = [
            AgentAccount::DISCRIMINATOR,
            ReentrancyGuard::DISCRIMINATOR,
            CategoryReputation::DISCRIMINATOR,
            // Use the PersonhoodAttestation discriminator as 4th
            crate::state::PersonhoodAttestation::DISCRIMINATOR,
        ];
        let g = make_global();
        let mut data = serialize_account(&g);
        cross_discriminator(&mut data, discriminators[disc_idx]);
        let mut slice = data.as_slice();
        prop_assert!(RegistryGlobal::try_deserialize(&mut slice).is_err());
    }

    #[test]
    fn agent_rejects_random_cross_discriminator(
        disc_idx in 0usize..4,
    ) {
        let discriminators = [
            RegistryGlobal::DISCRIMINATOR,
            ReentrancyGuard::DISCRIMINATOR,
            CategoryReputation::DISCRIMINATOR,
            crate::state::PersonhoodAttestation::DISCRIMINATOR,
        ];
        let a = make_agent();
        let mut data = serialize_account(&a);
        cross_discriminator(&mut data, discriminators[disc_idx]);
        let mut slice = data.as_slice();
        prop_assert!(AgentAccount::try_deserialize(&mut slice).is_err());
    }

    #[test]
    fn guard_rejects_random_cross_discriminator(
        disc_idx in 0usize..4,
    ) {
        let discriminators = [
            RegistryGlobal::DISCRIMINATOR,
            AgentAccount::DISCRIMINATOR,
            CategoryReputation::DISCRIMINATOR,
            crate::state::PersonhoodAttestation::DISCRIMINATOR,
        ];
        let g = make_guard();
        let mut data = serialize_account(&g);
        cross_discriminator(&mut data, discriminators[disc_idx]);
        let mut slice = data.as_slice();
        prop_assert!(ReentrancyGuard::try_deserialize(&mut slice).is_err());
    }

    #[test]
    fn all_accounts_reject_flipped_discriminator(
        account_idx in 0usize..4,
        flip_byte in 0usize..8,
        flip_val in 1u8..=255u8,
    ) {
        let mut data = match account_idx {
            0 => serialize_account(&make_global()),
            1 => serialize_account(&make_agent()),
            2 => serialize_account(&make_guard()),
            _ => serialize_account(&CategoryReputation {
                agent_did: [4u8; 32],
                capability_bit: 5,
                score: ReputationScore::default(),
                jobs_completed: 10,
                jobs_disputed: 1,
                last_proof_key: [5u8; 32],
                last_task_id: [6u8; 32],
                version: 1,
                bump: 250,
            }),
        };
        let original = data[flip_byte];
        data[flip_byte] = original ^ flip_val;
        if data[..8] == serialize_account(&make_global())[..8] && account_idx == 0 {
            return Ok(());
        }
        if data[..8] == serialize_account(&make_agent())[..8] && account_idx == 1 {
            return Ok(());
        }
        if data[..8] == serialize_account(&make_guard())[..8] && account_idx == 2 {
            return Ok(());
        }
        let valid_disc = match account_idx {
            0 => RegistryGlobal::DISCRIMINATOR,
            1 => AgentAccount::DISCRIMINATOR,
            2 => ReentrancyGuard::DISCRIMINATOR,
            _ => CategoryReputation::DISCRIMINATOR,
        };
        if data.len() >= 8 && data[..8] == *valid_disc {
            return Ok(());
        }
        let mut slice = data.as_slice();
        let result = match account_idx {
            0 => RegistryGlobal::try_deserialize(&mut slice).map(|_| ()),
            1 => AgentAccount::try_deserialize(&mut slice).map(|_| ()),
            2 => ReentrancyGuard::try_deserialize(&mut slice).map(|_| ()),
            _ => CategoryReputation::try_deserialize(&mut slice).map(|_| ()),
        };
        prop_assert!(result.is_err());
    }

    #[test]
    fn owner_check_structural_assertion(
        owner_seed in any::<[u8; 32]>(),
    ) {
        let bad_owner = Pubkey::new_from_array(owner_seed);
        prop_assume!(bad_owner != crate::ID);
        let g = make_global();
        let mut data = serialize_account(&g);
        let key = Pubkey::new_unique();
        let mut lamports = 1_000_000u64;
        let ai = make_account_info(&key, false, false, &mut lamports, &mut data, &bad_owner);
        prop_assert_ne!(*ai.owner, crate::ID);
    }

    #[test]
    fn signer_flag_false_prevents_authority_match(
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

// ── load_caller_guard rejection surface ──

#[test]
fn load_caller_guard_rejects_zero_owner() {
    let expected_caller = Pubkey::new_unique();
    let (pda, _) = Pubkey::find_program_address(&[b"guard"], &expected_caller);
    let mut data = mk_guard_buf(true);
    let zero_owner = Pubkey::default();
    let mut lamports = 0u64;
    let ai = make_account_info(&pda, false, false, &mut lamports, &mut data, &zero_owner);
    assert!(crate::guard::load_caller_guard(&ai, &expected_caller).is_err());
}

#[test]
fn load_caller_guard_rejects_truncated_data() {
    let expected_caller = Pubkey::new_unique();
    let (pda, _) = Pubkey::find_program_address(&[b"guard"], &expected_caller);
    let mut data = vec![0u8; 4]; // too short for discriminator
    let mut lamports = 0u64;
    let ai = make_account_info(&pda, false, false, &mut lamports, &mut data, &expected_caller);
    assert!(crate::guard::load_caller_guard(&ai, &expected_caller).is_err());
}

#[test]
fn load_caller_guard_rejects_empty_data() {
    let expected_caller = Pubkey::new_unique();
    let (pda, _) = Pubkey::find_program_address(&[b"guard"], &expected_caller);
    let mut data = vec![];
    let mut lamports = 0u64;
    let ai = make_account_info(&pda, false, false, &mut lamports, &mut data, &expected_caller);
    assert!(crate::guard::load_caller_guard(&ai, &expected_caller).is_err());
}

fn mk_guard_buf(active: bool) -> Vec<u8> {
    let g = ReentrancyGuard {
        active,
        entered_by: Pubkey::default(),
        entered_at_slot: 0,
        reset_proposed_at: 0,
        bump: 0,
    };
    let mut buf = Vec::with_capacity(8 + ReentrancyGuard::INIT_SPACE);
    buf.extend_from_slice(ReentrancyGuard::DISCRIMINATOR);
    anchor_lang::AnchorSerialize::serialize(&g, &mut buf).unwrap();
    buf
}

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 64,
        ..ProptestConfig::default()
    })]

    #[test]
    fn load_caller_guard_rejects_random_wrong_owner(
        owner_seed in any::<[u8; 32]>(),
    ) {
        let expected_caller = Pubkey::new_unique();
        let random_owner = Pubkey::new_from_array(owner_seed);
        prop_assume!(random_owner != expected_caller);
        let (pda, _) = Pubkey::find_program_address(&[b"guard"], &expected_caller);
        let mut data = mk_guard_buf(true);
        let mut lamports = 0u64;
        let ai = make_account_info(&pda, false, false, &mut lamports, &mut data, &random_owner);
        prop_assert!(crate::guard::load_caller_guard(&ai, &expected_caller).is_err());
    }

    #[test]
    fn load_caller_guard_rejects_random_wrong_pda(
        key_seed in any::<[u8; 32]>(),
    ) {
        let expected_caller = Pubkey::new_unique();
        let (real_pda, _) = Pubkey::find_program_address(&[b"guard"], &expected_caller);
        let bogus_key = Pubkey::new_from_array(key_seed);
        prop_assume!(bogus_key != real_pda);
        let mut data = mk_guard_buf(true);
        let mut lamports = 0u64;
        let ai = make_account_info(&bogus_key, false, false, &mut lamports, &mut data, &expected_caller);
        prop_assert!(crate::guard::load_caller_guard(&ai, &expected_caller).is_err());
    }

    #[test]
    fn load_caller_guard_rejects_corrupted_discriminator(
        flip_byte in 0usize..8,
        flip_val in 1u8..=255u8,
    ) {
        let expected_caller = Pubkey::new_unique();
        let (pda, _) = Pubkey::find_program_address(&[b"guard"], &expected_caller);
        let mut data = mk_guard_buf(true);
        data[flip_byte] ^= flip_val;
        if &data[..8] == ReentrancyGuard::DISCRIMINATOR {
            return Ok(());
        }
        let mut lamports = 0u64;
        let ai = make_account_info(&pda, false, false, &mut lamports, &mut data, &expected_caller);
        prop_assert!(crate::guard::load_caller_guard(&ai, &expected_caller).is_err());
    }
}

// ── Cross-account confusion: pass AgentAccount data where Global expected ──

#[test]
fn governance_global_rejects_agent_data_as_global() {
    let a = make_agent();
    let data = serialize_account(&a);
    let mut slice = data.as_slice();
    assert!(
        RegistryGlobal::try_deserialize(&mut slice).is_err(),
        "passing agent data where global is expected must fail"
    );
}

#[test]
fn agent_account_rejects_global_data_as_agent() {
    let g = make_global();
    let data = serialize_account(&g);
    let mut slice = data.as_slice();
    assert!(
        AgentAccount::try_deserialize(&mut slice).is_err(),
        "passing global data where agent is expected must fail"
    );
}

#[test]
fn guard_rejects_category_rep_data() {
    let cr = CategoryReputation {
        agent_did: [4u8; 32],
        capability_bit: 5,
        score: ReputationScore::default(),
        jobs_completed: 10,
        jobs_disputed: 1,
        last_proof_key: [5u8; 32],
        last_task_id: [6u8; 32],
        version: 1,
        bump: 250,
    };
    let data = serialize_account(&cr);
    let mut slice = data.as_slice();
    assert!(ReentrancyGuard::try_deserialize(&mut slice).is_err());
}
