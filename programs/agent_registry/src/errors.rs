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
    #[msg("only the proof_verifier program may update reputation")]
    UnauthorizedReputationUpdate,
    #[msg("capability bit exceeds capability_mask width")]
    InvalidCapabilityBit,
    #[msg("agent has not declared this capability bit")]
    CapabilityNotDeclared,
    #[msg("task_id already applied to this category reputation")]
    ReputationReplay,
    #[msg("personhood attestation required but missing")]
    PersonhoodRequired,
    #[msg("personhood attestation has expired")]
    PersonhoodExpired,
    #[msg("personhood attestation has been revoked")]
    PersonhoodRevoked,
    #[msg("gatekeeper network or SAS issuer is not on the allowlist")]
    GatekeeperNotAllowed,
    #[msg("attestation operator does not match signer or bidder")]
    AttestationOperatorMismatch,
    #[msg("gateway token layout is invalid")]
    GatewayTokenInvalid,
    #[msg("gateway token state is not active")]
    GatewayTokenNotActive,
    #[msg("gateway token owner does not match operator")]
    GatewayTokenOwnerMismatch,
    #[msg("gatekeeper allowlist overflow")]
    GatekeeperListFull,
    #[msg("attestation is still valid; refresh not needed")]
    AttestationStillValid,
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
    #[msg("civic gateway program id has not been configured on RegistryGlobal")]
    CivicGatewayProgramNotSet,
    #[msg("civic gateway token account owner does not match civic gateway program")]
    CivicGatewayProgramMismatch,
}
