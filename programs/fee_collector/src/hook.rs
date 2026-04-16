use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::extension::{
    transfer_hook::TransferHook, BaseStateWithExtensions, StateWithExtensions,
};
use anchor_spl::token_2022::spl_token_2022::state::Mint as RawMint;

use crate::errors::FeeCollectorError;
use crate::events::HookRejected;
use crate::state::{AgentHookAllowlist, HookAllowlist};

pub fn get_transfer_hook_program_id(mint_info: &AccountInfo) -> Result<Option<Pubkey>> {
    let data = mint_info
        .try_borrow_data()
        .map_err(|_| error!(FeeCollectorError::MintParseFailed))?;
    let parsed = StateWithExtensions::<RawMint>::unpack(&data)
        .map_err(|_| error!(FeeCollectorError::MintParseFailed))?;
    match parsed.get_extension::<TransferHook>() {
        Ok(ext) => Ok(Option::<Pubkey>::from(ext.program_id)),
        Err(_) => Ok(None),
    }
}

pub fn assert_hook_allowed(
    mint_info: &AccountInfo,
    global: &HookAllowlist,
    per_agent: Option<&AgentHookAllowlist>,
) -> Result<()> {
    let hook = get_transfer_hook_program_id(mint_info)?;
    let Some(pid) = hook else {
        return Ok(());
    };
    if global.programs.iter().any(|p| p == &pid) {
        return Ok(());
    }
    if let Some(a) = per_agent {
        if a.extra_programs.iter().any(|p| p == &pid) {
            return Ok(());
        }
    }
    if global.default_deny {
        emit!(HookRejected {
            mint: mint_info.key(),
            hook_program: pid,
            site: 0,
            timestamp: Clock::get().map(|c| c.unix_timestamp).unwrap_or(0),
        });
        return err!(FeeCollectorError::HookNotAllowed);
    }
    msg!("WARN: unwhitelisted hook program {}", pid);
    Ok(())
}

pub fn assert_hook_allowed_at_site(
    mint_info: &AccountInfo,
    global: &HookAllowlist,
    per_agent: Option<&AgentHookAllowlist>,
    site: u8,
) -> Result<()> {
    let hook = get_transfer_hook_program_id(mint_info)?;
    let Some(pid) = hook else {
        return Ok(());
    };
    if global.programs.iter().any(|p| p == &pid) {
        return Ok(());
    }
    if let Some(a) = per_agent {
        if a.extra_programs.iter().any(|p| p == &pid) {
            return Ok(());
        }
    }
    let now = Clock::get().map(|c| c.unix_timestamp).unwrap_or(0);
    if global.default_deny {
        emit!(HookRejected {
            mint: mint_info.key(),
            hook_program: pid,
            site,
            timestamp: now,
        });
        return err!(FeeCollectorError::HookNotAllowed);
    }
    emit!(HookRejected {
        mint: mint_info.key(),
        hook_program: pid,
        site,
        timestamp: now,
    });
    msg!("WARN: unwhitelisted hook program {} at site {}", pid, site);
    Ok(())
}

pub fn inspect_mint_extensions(mint_info: &AccountInfo) -> Result<MintExtensionReport> {
    use anchor_spl::token_2022::spl_token_2022::extension::{
        default_account_state::DefaultAccountState, permanent_delegate::PermanentDelegate,
        transfer_fee::TransferFeeConfig,
    };

    let data = mint_info
        .try_borrow_data()
        .map_err(|_| error!(FeeCollectorError::MintParseFailed))?;
    let parsed = StateWithExtensions::<RawMint>::unpack(&data)
        .map_err(|_| error!(FeeCollectorError::MintParseFailed))?;

    let hook_program = parsed
        .get_extension::<TransferHook>()
        .ok()
        .and_then(|e| Option::<Pubkey>::from(e.program_id));

    let transfer_fee_authority = parsed
        .get_extension::<TransferFeeConfig>()
        .ok()
        .and_then(|e| Option::<Pubkey>::from(e.transfer_fee_config_authority));
    let has_transfer_fee_ext = parsed.get_extension::<TransferFeeConfig>().is_ok();

    let default_state_frozen = parsed
        .get_extension::<DefaultAccountState>()
        .map(|e| e.state == 2) // AccountState::Frozen == 2
        .unwrap_or(false);

    let permanent_delegate = parsed
        .get_extension::<PermanentDelegate>()
        .ok()
        .and_then(|e| Option::<Pubkey>::from(e.delegate));

    Ok(MintExtensionReport {
        hook_program,
        has_transfer_fee_ext,
        transfer_fee_authority,
        default_state_frozen,
        permanent_delegate,
    })
}

pub struct MintExtensionReport {
    pub hook_program: Option<Pubkey>,
    pub has_transfer_fee_ext: bool,
    pub transfer_fee_authority: Option<Pubkey>,
    pub default_state_frozen: bool,
    pub permanent_delegate: Option<Pubkey>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pk(n: u8) -> Pubkey {
        Pubkey::new_from_array([n; 32])
    }

    fn global_with(programs: Vec<Pubkey>, default_deny: bool) -> HookAllowlist {
        HookAllowlist {
            authority: Pubkey::default(),
            pending_authority: None,
            programs,
            default_deny,
            bump: 0,
        }
    }

    fn per_agent_with(extras: Vec<Pubkey>) -> AgentHookAllowlist {
        AgentHookAllowlist {
            agent_did: [0u8; 32],
            extra_programs: extras,
            bump: 0,
        }
    }

    // Pure-logic unit — mirrors assert_hook_allowed's decision branches, exposed
    // for unit tests that can't construct a full AccountInfo for extension parsing.
    fn check(
        hook: Option<Pubkey>,
        global: &HookAllowlist,
        per_agent: Option<&AgentHookAllowlist>,
    ) -> Result<bool> {
        let Some(pid) = hook else { return Ok(true); };
        if global.programs.iter().any(|p| p == &pid) {
            return Ok(true);
        }
        if let Some(a) = per_agent {
            if a.extra_programs.iter().any(|p| p == &pid) {
                return Ok(true);
            }
        }
        if global.default_deny {
            return err!(FeeCollectorError::HookNotAllowed);
        }
        Ok(false)
    }

    #[test]
    fn no_hook_always_ok() {
        let g = global_with(vec![], true);
        assert!(check(None, &g, None).unwrap());
    }

    #[test]
    fn hook_in_global_allowlist_accepted() {
        let g = global_with(vec![pk(1), pk(2)], true);
        assert!(check(Some(pk(2)), &g, None).unwrap());
    }

    #[test]
    fn hook_missing_and_default_deny_rejected() {
        let g = global_with(vec![pk(1)], true);
        assert!(check(Some(pk(9)), &g, None).is_err());
    }

    #[test]
    fn hook_missing_warn_only_accepted() {
        let g = global_with(vec![pk(1)], false);
        let ok = check(Some(pk(9)), &g, None).unwrap();
        assert!(!ok);
    }

    #[test]
    fn per_agent_extra_unblocks_hook() {
        let g = global_with(vec![pk(1)], true);
        let a = per_agent_with(vec![pk(9)]);
        assert!(check(Some(pk(9)), &g, Some(&a)).unwrap());
    }

    #[test]
    fn per_agent_without_match_defers_to_global() {
        let g = global_with(vec![pk(1)], true);
        let a = per_agent_with(vec![pk(5)]);
        assert!(check(Some(pk(9)), &g, Some(&a)).is_err());
    }

    // Mirrors the in-place mutation logic in `update_handler`. Kept here because
    // the Accounts harness is unavailable in pure unit tests.
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
            existing.len() <= MAX_HOOK_PROGRAMS,
            FeeCollectorError::HookAllowlistFull
        );
        Ok(())
    }

    use crate::state::MAX_HOOK_PROGRAMS;

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
        let mut list: Vec<Pubkey> = (1..=MAX_HOOK_PROGRAMS as u8).map(pk).collect();
        let overflow = vec![pk(255)];
        assert!(apply_mutation(&mut list, &overflow, &[]).is_err());
    }

    #[test]
    fn allowlist_default_deny_flip_changes_resolution() {
        let pid = pk(42);
        let mut g = global_with(vec![], true);
        assert!(check(Some(pid), &g, None).is_err());
        g.default_deny = false;
        let resolved = check(Some(pid), &g, None).unwrap();
        assert!(!resolved);
    }
}
