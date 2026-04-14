use anchor_lang::prelude::*;

#[error_code]
pub enum AgentRegistryError {
    #[msg("signer is not authorized for this instruction")]
    Unauthorized,
    #[msg("registry is paused")]
    Paused,
    #[msg("capability mask contains unapproved bits")]
    InvalidCapability,
    #[msg("stake is below configured minimum")]
    StakeBelowMinimum,
    #[msg("agent already exists for these seeds")]
    AgentExists,
    #[msg("agent not found")]
    AgentNotFound,
    #[msg("illegal status transition")]
    InvalidStatusTransition,
    #[msg("a slash is already pending")]
    SlashPending,
    #[msg("slash amount exceeds per-incident bound")]
    SlashBoundExceeded,
    #[msg("slash timelock has not elapsed")]
    TimelockNotElapsed,
    #[msg("a withdrawal is already pending")]
    WithdrawalPending,
    #[msg("no pending slash")]
    NoPendingSlash,
    #[msg("no pending withdrawal")]
    NoPendingWithdrawal,
    #[msg("arithmetic overflow")]
    ArithmeticOverflow,
    #[msg("manifest uri invalid")]
    InvalidManifest,
    #[msg("caller is not the TaskMarket program")]
    CallerNotTaskMarket,
    #[msg("no pending authority to accept")]
    NoPendingAuthority,
    #[msg("max_slash_bps above 10% cap")]
    SlashCapTooHigh,
    #[msg("reputation value out of range")]
    ReputationOutOfRange,
}
