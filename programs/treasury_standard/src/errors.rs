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
    #[msg("route_data exceeds MAX_ROUTE_DATA_LEN")]
    RouteDataTooLong,
    #[msg("swap consumed more tokens than earned")]
    SwapAmountExceeded,
    #[msg("oracle price feed required for cross-mint withdrawal")]
    OracleRequired,
    #[msg("oracle price is non-positive")]
    OracleNonPositivePrice,
    #[msg("agent DID does not match AgentAccount")]
    AgentMismatch,
    #[msg("operator does not match AgentAccount operator")]
    OperatorMismatch,
    #[msg("outbound CPI target is not on the allowed-call-targets list")]
    TargetNotAllowed,
    #[msg("allowed-call-targets list exceeds cap")]
    TooManyCallTargets,
    #[msg("call target must be a non-default pubkey")]
    InvalidCallTarget,
    #[msg("transfer-hook program not on fee_collector allowlist")]
    HookNotAllowed,
    #[msg("hook_allowlist pointer has already been set")]
    HookAllowlistAlreadySet,
    #[msg("hook_allowlist account does not match TreasuryGlobal.hook_allowlist")]
    HookAllowlistMismatch,
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
    #[msg("yield strategy name exceeds maximum length")]
    YieldNameTooLong,
    #[msg("yield strategy metadata URI exceeds maximum length")]
    YieldUriTooLong,
    #[msg("yield allocation must be between 0 and 10_000 bps")]
    YieldAllocationInvalid,
    #[msg("yield allocation exceeds the strategy cap")]
    YieldAllocationExceeded,
    #[msg("yield strategy is not active")]
    YieldStrategyNotActive,
    #[msg("treasury yield config is not active")]
    TreasuryYieldNotActive,
    #[msg("treasury yield accounting slot moved backwards")]
    YieldAccountingStale,
    #[msg("yield movement route data is required")]
    YieldRouteRequired,
    #[msg("yield venue is not supported by this instruction")]
    UnsupportedYieldVenue,
    #[msg("yield strategy program does not match the Kamino program account")]
    InvalidYieldProgram,
    #[msg("yield strategy mint does not match the provided vault mint")]
    YieldMintMismatch,
    #[msg("yield strategy receipt mint does not match the provided receipt mint")]
    YieldReceiptMintMismatch,
    #[msg("yield deposit exceeded the requested amount")]
    YieldDepositAmountExceeded,
    #[msg("yield withdrawal exceeded the requested receipt amount")]
    YieldWithdrawAmountExceeded,
    #[msg("yield movement did not change balances")]
    YieldNoBalanceDelta,
    #[msg("yield position is closed")]
    YieldPositionClosed,
    #[msg("emergency unwind did not fully drain the receipt vault")]
    YieldUnwindIncomplete,
}
