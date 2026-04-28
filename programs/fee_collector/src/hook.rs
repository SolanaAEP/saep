use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::extension::{BaseStateWithExtensions, StateWithExtensions};
use anchor_spl::token_2022::spl_token_2022::state::Mint as RawMint;

use crate::errors::FeeCollectorError;
use crate::events::MintRejected;
use crate::state::{AgentMintAllowlist, MintAllowlist};

pub fn assert_mint_allowed(
    mint_info: &AccountInfo,
    global: &MintAllowlist,
    per_agent: Option<&AgentMintAllowlist>,
) -> Result<()> {
    let mint_key = mint_info.key();
    if global.programs.iter().any(|p| p == &mint_key) {
        return Ok(());
    }
    if let Some(a) = per_agent {
        if a.extra_programs.iter().any(|p| p == &mint_key) {
            return Ok(());
        }
    }
    if global.default_deny {
        emit!(MintRejected {
            mint: mint_key,
            reason: 1,
            site: 0,
            timestamp: Clock::get().map(|c| c.unix_timestamp).unwrap_or(0),
        });
        return err!(FeeCollectorError::MintNotAllowed);
    }
    msg!("WARN: unwhitelisted mint {}", mint_key);
    Ok(())
}

pub fn assert_mint_allowed_at_site(
    mint_info: &AccountInfo,
    global: &MintAllowlist,
    per_agent: Option<&AgentMintAllowlist>,
    site: u8,
) -> Result<()> {
    let mint_key = mint_info.key();
    if global.programs.iter().any(|p| p == &mint_key) {
        return Ok(());
    }
    if let Some(a) = per_agent {
        if a.extra_programs.iter().any(|p| p == &mint_key) {
            return Ok(());
        }
    }
    let now = Clock::get().map(|c| c.unix_timestamp).unwrap_or(0);
    if global.default_deny {
        emit!(MintRejected {
            mint: mint_key,
            reason: 1,
            site,
            timestamp: now,
        });
        return err!(FeeCollectorError::MintNotAllowed);
    }
    emit!(MintRejected {
        mint: mint_key,
        reason: 0,
        site,
        timestamp: now,
    });
    msg!("WARN: unwhitelisted mint {} at site {}", mint_key, site);
    Ok(())
}


pub fn inspect_mint_extensions(mint_info: &AccountInfo) -> Result<MintExtensionReport> {
    if mint_info.owner != &anchor_spl::token_2022::ID {
        return Ok(MintExtensionReport {
            has_transfer_fee_ext: false,
            transfer_fee_authority: None,
            default_state_frozen: false,
            has_confidential_transfer_ext: false,
            confidential_transfer_authority: None,
        });
    }

    use anchor_spl::token_2022::spl_token_2022::extension::{
        confidential_transfer::ConfidentialTransferMint,
        default_account_state::DefaultAccountState, transfer_fee::TransferFeeConfig,
    };

    let data = mint_info
        .try_borrow_data()
        .map_err(|_| error!(FeeCollectorError::MintParseFailed))?;
    let parsed = StateWithExtensions::<RawMint>::unpack(&data)
        .map_err(|_| error!(FeeCollectorError::MintParseFailed))?;

    let transfer_fee_authority = parsed
        .get_extension::<TransferFeeConfig>()
        .ok()
        .and_then(|e| Option::<Pubkey>::from(e.transfer_fee_config_authority));
    let has_transfer_fee_ext = parsed.get_extension::<TransferFeeConfig>().is_ok();

    let default_state_frozen = parsed
        .get_extension::<DefaultAccountState>()
        .map(|e| e.state == 2)
        .unwrap_or(false);

    let has_confidential_transfer_ext = parsed
        .get_extension::<ConfidentialTransferMint>()
        .is_ok();

    let confidential_transfer_authority = parsed
        .get_extension::<ConfidentialTransferMint>()
        .ok()
        .and_then(|e| Option::<Pubkey>::from(e.authority));

    Ok(MintExtensionReport {
        has_transfer_fee_ext,
        transfer_fee_authority,
        default_state_frozen,
        has_confidential_transfer_ext,
        confidential_transfer_authority,
    })
}

pub struct MintExtensionReport {
    pub has_transfer_fee_ext: bool,
    pub transfer_fee_authority: Option<Pubkey>,
    pub default_state_frozen: bool,
    pub has_confidential_transfer_ext: bool,
    pub confidential_transfer_authority: Option<Pubkey>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::MAX_MINT_ALLOWLIST_PROGRAMS;

    fn pk(n: u8) -> Pubkey {
        Pubkey::new_from_array([n; 32])
    }

    fn global_with(programs: Vec<Pubkey>, default_deny: bool) -> MintAllowlist {
        MintAllowlist {
            authority: Pubkey::default(),
            pending_authority: None,
            programs,
            default_deny,
            bump: 0,
        }
    }

    fn per_agent_with(extras: Vec<Pubkey>) -> AgentMintAllowlist {
        AgentMintAllowlist {
            agent_did: [0u8; 32],
            extra_programs: extras,
            bump: 0,
        }
    }

    fn check(
        mint_key: Pubkey,
        global: &MintAllowlist,
        per_agent: Option<&AgentMintAllowlist>,
    ) -> Result<bool> {
        if global.programs.iter().any(|p| p == &mint_key) {
            return Ok(true);
        }
        if let Some(a) = per_agent {
            if a.extra_programs.iter().any(|p| p == &mint_key) {
                return Ok(true);
            }
        }
        if global.default_deny {
            return err!(FeeCollectorError::MintNotAllowed);
        }
        Ok(false)
    }

    #[test]
    fn no_match_with_no_deny_warns() {
        let g = global_with(vec![], false);
        let ok = check(pk(9), &g, None).unwrap();
        assert!(!ok);
    }

    #[test]
    fn mint_in_global_allowlist_accepted() {
        let g = global_with(vec![pk(1), pk(2)], true);
        assert!(check(pk(2), &g, None).unwrap());
    }

    #[test]
    fn mint_missing_and_default_deny_rejected() {
        let g = global_with(vec![pk(1)], true);
        assert!(check(pk(9), &g, None).is_err());
    }

    #[test]
    fn per_agent_extra_unblocks_mint() {
        let g = global_with(vec![pk(1)], true);
        let a = per_agent_with(vec![pk(9)]);
        assert!(check(pk(9), &g, Some(&a)).unwrap());
    }

    #[test]
    fn per_agent_without_match_defers_to_global() {
        let g = global_with(vec![pk(1)], true);
        let a = per_agent_with(vec![pk(5)]);
        assert!(check(pk(9), &g, Some(&a)).is_err());
    }

    fn apply_mutation(
        existing: &mut Vec<Pubkey>,
        add: &[Pubkey],
        remove: &[Pubkey],
    ) -> Result<()> {
        for r in remove {
            existing.retain(|p| p != r);
        }
        for p in add {
            require!(*p != Pubkey::default(), FeeCollectorError::InvalidProgramId);
            if !existing.iter().any(|e| e == p) {
                existing.push(*p);
            }
        }
        require!(
            existing.len() <= MAX_MINT_ALLOWLIST_PROGRAMS,
            FeeCollectorError::MintAllowlistFull
        );
        Ok(())
    }

    #[test]
    fn allowlist_add_remove_applies_in_place() {
        let mut list = vec![pk(1), pk(2), pk(3)];
        apply_mutation(&mut list, &[pk(4), pk(2)], &[pk(1)]).unwrap();
        assert_eq!(list, vec![pk(2), pk(3), pk(4)]);
    }

    #[test]
    fn allowlist_rejects_default_pubkey() {
        let mut list: Vec<Pubkey> = vec![];
        assert!(apply_mutation(&mut list, &[Pubkey::default()], &[]).is_err());
    }

    #[test]
    fn allowlist_enforces_cap() {
        let mut list: Vec<Pubkey> = (1..=MAX_MINT_ALLOWLIST_PROGRAMS as u8).map(pk).collect();
        let overflow = vec![pk(255)];
        assert!(apply_mutation(&mut list, &overflow, &[]).is_err());
    }

    #[test]
    fn default_deny_flip_changes_resolution() {
        let mint = pk(42);
        let mut g = global_with(vec![], true);
        assert!(check(mint, &g, None).is_err());
        g.default_deny = false;
        let resolved = check(mint, &g, None).unwrap();
        assert!(!resolved);
    }
}
