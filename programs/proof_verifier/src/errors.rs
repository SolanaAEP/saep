use anchor_lang::prelude::*;

#[error_code]
pub enum ProofVerifierError {
    #[msg("signer is not the verifier authority")]
    Unauthorized,
    #[msg("verifier is paused")]
    Paused,
    #[msg("verifying key already exists")]
    VkAlreadyExists,
    #[msg("verifying key not found")]
    VkNotFound,
    #[msg("provided verifying key does not match active vk")]
    VkMismatch,
    #[msg("public input count does not match verifying key")]
    PublicInputCountMismatch,
    #[msg("public input exceeds bn254 scalar field modulus")]
    PublicInputOutOfField,
    #[msg("proof bytes failed curve deserialization")]
    ProofMalformed,
    #[msg("pairing check failed")]
    ProofInvalid,
    #[msg("timelock has not elapsed")]
    TimelockNotElapsed,
    #[msg("no pending vk activation")]
    NoPendingActivation,
    #[msg("a vk activation is already pending")]
    ActivationPending,
    #[msg("non-production vk cannot be activated in mainnet mode")]
    NotProductionVk,
    #[msg("ic length must equal num_public_inputs + 1")]
    IcLengthMismatch,
    #[msg("num_public_inputs exceeds m1 cap of 16")]
    TooManyPublicInputs,
    #[msg("no pending authority to accept")]
    NoPendingAuthority,
    #[msg("not implemented in m1")]
    NotImplemented,
    #[msg("batch size must be 1-10")]
    InvalidBatchSize,
    #[msg("batch is full")]
    BatchFull,
    #[msg("batch has no proofs")]
    BatchEmpty,
    #[msg("batch vk does not match active vk")]
    BatchVkMismatch,
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
    #[msg("reputation args are not yet bound to the circuit's public outputs; rail disabled")]
    ReputationBindingNotReady,
    #[msg("on-chain poseidon hash of sample does not match proof's sample_hash commitment")]
    SampleHashMismatch,
    #[msg("poseidon hash computation failed")]
    PoseidonError,
    #[msg("vk is already finalized and cannot accept more ic points")]
    VkAlreadyFinalized,
}
