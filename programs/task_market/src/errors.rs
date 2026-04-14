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
}
