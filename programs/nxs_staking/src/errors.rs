use anchor_lang::prelude::*;

#[error_code]
pub enum NxsStakingError {
    #[msg("signer is not authorized for this instruction")]
    Unauthorized,
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
    #[msg("staking pool is paused")]
    Paused,
    #[msg("lockup duration out of allowed range")]
    InvalidLockup,
    #[msg("amount must be greater than zero")]
    ZeroAmount,
    #[msg("lockup period has not ended")]
    LockupNotEnded,
    #[msg("cooldown period has not ended")]
    CooldownNotEnded,
    #[msg("stake account is not active")]
    NotActive,
    #[msg("stake account is not in cooldown")]
    NotInCooldown,
    #[msg("arithmetic overflow")]
    ArithmeticOverflow,
    #[msg("epoch has not ended yet")]
    EpochNotEnded,
    #[msg("deposits are frozen for this pool (migration window)")]
    DepositsFrozen,
    #[msg("deposits are not frozen; nothing to unfreeze")]
    DepositsNotFrozen,
}
