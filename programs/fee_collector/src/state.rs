use anchor_lang::prelude::*;

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

pub const SITE_FUND_TASK: u8 = 1;
pub const SITE_RELEASE: u8 = 2;
pub const SITE_EXPIRE: u8 = 3;
pub const SITE_STREAM_WITHDRAW: u8 = 4;
pub const SITE_STREAM_SWAP: u8 = 5;
pub const SITE_STREAM_CLOSE: u8 = 6;
// F-2026-06: new call-site ids for previously-unwrapped transfer_checked CPIs.
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
