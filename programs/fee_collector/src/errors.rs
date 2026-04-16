use anchor_lang::prelude::*;

#[error_code]
pub enum FeeCollectorError {
    #[msg("signer is not authorized for this instruction")]
    Unauthorized,
    #[msg("transfer-hook program is not on the allowlist")]
    HookNotAllowed,
    #[msg("hook allowlist is at capacity")]
    HookAllowlistFull,
    #[msg("per-agent hook allowlist is at capacity")]
    AgentHookAllowlistFull,
    #[msg("program id must be a non-default pubkey")]
    InvalidProgramId,
    #[msg("mint extension configuration is not acceptable")]
    MintExtensionRejected,
    #[msg("failed to parse Token-2022 mint extensions")]
    MintParseFailed,
    #[msg("no pending authority to accept")]
    NoPendingAuthority,
}
