use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};

pub fn execute_swap<'info>(
    jupiter_program: &AccountInfo<'info>,
    route_accounts: &[AccountInfo<'info>],
    route_data: Vec<u8>,
    signer_seeds: &[&[&[u8]]],
    pda_signer: &Pubkey,
) -> Result<()> {
    let account_metas: Vec<AccountMeta> = route_accounts
        .iter()
        .map(|acc| {
            let is_signer = acc.is_signer || acc.key == pda_signer;
            if acc.is_writable {
                AccountMeta::new(*acc.key, is_signer)
            } else {
                AccountMeta::new_readonly(*acc.key, is_signer)
            }
        })
        .collect();

    let ix = Instruction {
        program_id: jupiter_program.key(),
        accounts: account_metas,
        data: route_data,
    };

    let mut infos = Vec::with_capacity(route_accounts.len() + 1);
    infos.push(jupiter_program.clone());
    infos.extend(route_accounts.iter().cloned());

    invoke_signed(&ix, &infos, signer_seeds)?;
    Ok(())
}
