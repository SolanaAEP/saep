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
    #[msg("reentrancy detected — guard is already active")]
    ReentrancyDetected,
    #[msg("caller program is not on the allowed callers list")]
    UnauthorizedCaller,
    #[msg("caller program's reentrancy guard is not active")]
    CallerGuardNotActive,
    #[msg("cpi stack height exceeds allowed bound")]
    CpiDepthExceeded,
    #[msg("reentrancy guard is already active")]
    GuardAlreadyActive,
    #[msg("reentrancy guard has not been initialized")]
    GuardNotInitialized,
    #[msg("admin reset has not met the 24h timelock")]
    AdminResetNotTimelocked,
    #[msg("program is paused")]
    Paused,
    #[msg("bps quadruple must sum to 10000")]
    InvalidBpsSum,
    #[msg("bucket bps exceeds its hard cap")]
    BucketCapExceeded,
    #[msg("epoch is not in Open status")]
    EpochNotOpen,
    #[msg("epoch duration has not elapsed")]
    EpochNotElapsed,
    #[msg("intake vault balance does not match total_collected")]
    IntakeAccountingDrift,
    #[msg("distribution root already committed for this epoch")]
    DistributionAlreadyCommitted,
    #[msg("distribution commit window has elapsed")]
    DistributionWindowElapsed,
    #[msg("merkle proof is invalid")]
    MerkleProofInvalid,
    #[msg("merkle proof exceeds max depth")]
    MerkleProofTooDeep,
    #[msg("claim would exceed staker_amount for this epoch")]
    ClaimOverflow,
    #[msg("claim window has elapsed")]
    ClaimWindowElapsed,
    #[msg("burn amount below minimum threshold")]
    BurnBelowThreshold,
    #[msg("burn already executed for this epoch")]
    BurnAlreadyExecuted,
    #[msg("sweep grace period has not elapsed")]
    SweepGraceNotElapsed,
    #[msg("epoch has already been swept")]
    AlreadySwept,
    #[msg("invalid epoch status for this operation")]
    InvalidEpochStatus,
    #[msg("arithmetic overflow")]
    ArithmeticOverflow,
    #[msg("caller is not a registered slash source")]
    CallerNotRegisteredSlasher,
    #[msg("epoch duration out of allowed range")]
    InvalidEpochDuration,
    #[msg("claim window out of allowed range")]
    InvalidClaimWindow,
}
