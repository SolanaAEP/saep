use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::extension::{
    confidential_transfer::ConfidentialTransferAccount, BaseStateWithExtensions,
    StateWithExtensions,
};
use anchor_spl::token_2022::spl_token_2022::state::Account as RawAccount;
use anchor_spl::token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::state::FeeCollectorConfig;

pub fn has_confidential_transfer_configured(token_account: &AccountInfo) -> bool {
    if token_account.owner != &anchor_spl::token_2022::ID {
        return false;
    }
    let Ok(data) = token_account.try_borrow_data() else {
        return false;
    };
    let Ok(parsed) = StateWithExtensions::<RawAccount>::unpack(&data) else {
        return false;
    };
    parsed
        .get_extension::<ConfidentialTransferAccount>()
        .map(|ext| bool::from(ext.approved))
        .unwrap_or(false)
}

/// Transfer tokens, choosing plaintext or confidential based on destination
/// account configuration and the governance feature gate.
///
/// When `confidential_transfers_enabled` is false OR the destination doesn't
/// have CT configured, falls through to standard `transfer_checked`.
///
/// When CT is active and the destination is configured, this currently still
/// uses plaintext `transfer_checked` from program-owned vaults (which are
/// always plaintext). Full confidential CPI requires client-side proof
/// generation and will land in Phase 2 when ZK ElGamal re-enables.
///
/// The function signature is designed so that call sites don't change when
/// the confidential CPI path is wired up — only this body changes.
pub fn transfer_maybe_confidential<'info>(
    config: &FeeCollectorConfig,
    token_program: &Interface<'info, TokenInterface>,
    from: &InterfaceAccount<'info, TokenAccount>,
    to_info: &AccountInfo<'info>,
    mint: &InterfaceAccount<'info, Mint>,
    authority: &AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
    amount: u64,
    decimals: u8,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }

    let _dest_has_ct = config.confidential_transfers_enabled
        && has_confidential_transfer_configured(to_info);

    // Phase 2: when ZK ElGamal re-enables, add confidential_transfer CPI path
    // here for dest_has_ct == true. Requires split proofs generated off-chain
    // and passed as remaining_accounts or via proof buffer account.

    transfer_checked(
        CpiContext::new_with_signer(
            token_program.key(),
            TransferChecked {
                from: from.to_account_info(),
                mint: mint.to_account_info(),
                to: to_info.clone(),
                authority: authority.clone(),
            },
            signer_seeds,
        ),
        amount,
        decimals,
    )
}
