use anchor_lang::prelude::*;

#[error_code]
pub enum TreasuryError {
    #[msg("signer is not authorized for this instruction")]
    Unauthorized,
    #[msg("treasury is paused")]
    Paused,
    #[msg("mint is not on the allowlist")]
    MintNotAllowed,
    #[msg("spending or transfer limit exceeded")]
    LimitExceeded,
    #[msg("vault balance insufficient")]
    InsufficientVault,
    #[msg("a stream is already active for this treasury")]
    StreamAlreadyActive,
    #[msg("stream is not active")]
    StreamNotActive,
    #[msg("stream is already closed")]
    StreamAlreadyClosed,
    #[msg("stream duration invalid")]
    InvalidDuration,
    #[msg("stream rate invalid")]
    InvalidRate,
    #[msg("oracle price is stale")]
    OracleStale,
    #[msg("oracle confidence interval too wide")]
    OracleConfidenceTooWide,
    #[msg("swap exceeded slippage tolerance")]
    SwapSlippage,
    #[msg("arithmetic overflow")]
    ArithmeticOverflow,
    #[msg("caller is not TaskMarket program")]
    CallerNotTaskMarket,
    #[msg("agent is not active in AgentRegistry")]
    AgentNotActive,
    #[msg("limits violate per_tx <= daily <= weekly invariant")]
    InvalidLimits,
    #[msg("allowed-mints list is full")]
    AllowedMintsFull,
    #[msg("mint not found in allowlist")]
    MintNotFound,
    #[msg("no pending authority to accept")]
    NoPendingAuthority,
    #[msg("amount must be greater than zero")]
    ZeroAmount,
    #[msg("pay_task is reserved for M2 and is inert in M1")]
    PayTaskDisabled,
    #[msg("jupiter program does not match configured address")]
    InvalidJupiterProgram,
    #[msg("swap route data required for cross-mint withdrawal")]
    SwapRouteRequired,
    #[msg("swap consumed more tokens than earned")]
    SwapAmountExceeded,
}
