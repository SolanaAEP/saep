use anchor_lang::prelude::*;

#[error_code]
pub enum TaskMarketError {
    #[msg("signer is not authorized for this instruction")]
    Unauthorized,
    #[msg("market is paused")]
    Paused,
    #[msg("payment mint is not allowed")]
    MintNotAllowed,
    #[msg("payment amount must be positive")]
    InvalidAmount,
    #[msg("deadline must be in the future")]
    InvalidDeadline,
    #[msg("deadline exceeds max_deadline_secs")]
    DeadlineTooFar,
    #[msg("agent is not active")]
    AgentNotActive,
    #[msg("task is in the wrong status for this instruction")]
    WrongStatus,
    #[msg("deadline has passed")]
    DeadlinePassed,
    #[msg("dispute window has closed")]
    DisputeWindowClosed,
    #[msg("dispute window is still open")]
    DisputeWindowOpen,
    #[msg("task is not yet expired")]
    NotExpired,
    #[msg("escrow balance mismatch")]
    EscrowMismatch,
    #[msg("arithmetic overflow")]
    ArithmeticOverflow,
    #[msg("proof verification failed")]
    ProofInvalid,
    #[msg("signer is not the operator of the assigned agent")]
    CallerNotOperator,
    #[msg("task not found")]
    TaskNotFound,
    #[msg("fee bps exceeds bound")]
    FeeBoundExceeded,
    #[msg("milestone_count exceeds maximum")]
    TooManyMilestones,
    #[msg("no pending authority to accept")]
    NoPendingAuthority,
    #[msg("grace period has not elapsed")]
    GraceNotElapsed,
    #[msg("result hash must be non-zero")]
    ZeroResultHash,
    #[msg("agent DID does not match task assignment")]
    AgentMismatch,
    #[msg("agent registry CPI failed")]
    OutcomeCpiFailed,
    #[msg("agent stake below required minimum")]
    InsufficientStake,
    #[msg("bid phase closed for this action")]
    PhaseClosed,
    #[msg("revealed bid does not match commit hash")]
    RevealMismatch,
    #[msg("bond bps out of allowed range")]
    BondOutOfRange,
    #[msg("bid book is at capacity")]
    TooManyBidders,
    #[msg("bid book has not been settled")]
    BidBookNotSettled,
    #[msg("signer is not the winning bidder")]
    NotWinner,
    #[msg("no eligible reveals in bid book")]
    NoReveals,
    #[msg("bond has already been claimed")]
    AlreadyRefunded,
    #[msg("bid window parameters invalid")]
    WindowInvalid,
    #[msg("task already has an open bid book")]
    BidBookAlreadyOpen,
    #[msg("bid book has active commits; cannot cancel")]
    CommitsPresent,
    #[msg("task payload exceeds size caps")]
    PayloadTooLarge,
    #[msg("capability_bit out of allowed range")]
    InvalidCapabilityBit,
    #[msg("agent does not advertise the requested capability_bit")]
    UnknownCapability,
    #[msg("personhood attestation required but missing")]
    PersonhoodRequired,
    #[msg("personhood attestation has expired")]
    PersonhoodExpired,
    #[msg("personhood attestation has been revoked")]
    PersonhoodRevoked,
    #[msg("attestation operator does not match bidder")]
    AttestationOperatorMismatch,
    #[msg("transfer-hook program not on fee_collector allowlist")]
    HookNotAllowed,
    #[msg("mint extension configuration is not acceptable")]
    MintExtensionRejected,
    #[msg("hook_allowlist account does not match MarketGlobal hook_allowlist")]
    HookAllowlistMismatch,
    #[msg("mint already has a MintAcceptRecord")]
    MintAlreadyAccepted,
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
    #[msg("close_bidding must receive every revealed bid in remaining_accounts")]
    IncompleteBidEnumeration,
    #[msg("duplicate bid detected in close_bidding enumeration")]
    DuplicateBidEnumeration,
    #[msg("agent has not declared the task's capability bit")]
    CapabilityNotInAgentMask,
}
