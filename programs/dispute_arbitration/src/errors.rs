use anchor_lang::prelude::*;

#[error_code]
pub enum DisputeArbitrationError {
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
    #[msg("program is paused")]
    Paused,
    #[msg("dispute pool has not been snapshotted")]
    PoolMissing,
    #[msg("dispute pool has too few eligible arbitrators")]
    PoolTooSmall,
    #[msg("VRF result is stale")]
    VrfStale,
    #[msg("VRF has not been fulfilled")]
    VrfNotFulfilled,
    #[msg("invalid status for this operation")]
    WrongStatus,
    #[msg("commit window has closed")]
    CommitWindowClosed,
    #[msg("reveal window has closed")]
    RevealWindowClosed,
    #[msg("reveal window has not closed yet")]
    RevealWindowOpen,
    #[msg("commit hash does not match revealed data")]
    CommitHashMismatch,
    #[msg("arbitrator has already voted in this round")]
    DuplicateVote,
    #[msg("arbitrator was not selected for this case")]
    ArbitratorNotSelected,
    #[msg("appeal window has closed")]
    AppealWindowClosed,
    #[msg("appeal collateral is insufficient")]
    AppealCollateralInsufficient,
    #[msg("maximum number of appeals reached")]
    TooManyAppeals,
    #[msg("a pending slash already exists for this arbitrator")]
    SlashAlreadyPending,
    #[msg("slash timelock has not elapsed")]
    SlashTimelockNotElapsed,
    #[msg("no clean majority was reached")]
    NoMajority,
    #[msg("verdict encoding is invalid")]
    VerdictEncodingInvalid,
    #[msg("stake is below minimum requirement")]
    StakeInsufficient,
    #[msg("stake lockup is too short")]
    StakeLockTooShort,
    #[msg("arithmetic overflow")]
    ArithmeticOverflow,
    #[msg("caller is not the task market program")]
    CallerNotTaskMarket,
    #[msg("arbitrator is not active")]
    ArbitratorNotActive,
    #[msg("pool is at maximum capacity")]
    PoolFull,
    #[msg("arbitrator already registered")]
    AlreadyRegistered,
    #[msg("appeal window has not elapsed")]
    AppealWindowOpen,
    #[msg("execution window has not elapsed")]
    ExecutionWindowOpen,
    #[msg("arbitrator is not in withdrawing status")]
    NotWithdrawing,
    #[msg("withdraw unlock time has not been reached")]
    WithdrawNotReady,
    #[msg("bad faith threshold not met for slash")]
    BadFaithThresholdNotMet,
    #[msg("invalid bps value")]
    InvalidBps,
}
