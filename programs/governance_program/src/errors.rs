use anchor_lang::prelude::*;

#[error_code]
pub enum GovernanceError {
    #[msg("signer is not authorized")]
    Unauthorized,
    #[msg("governance is paused")]
    Paused,
    #[msg("proposal is not in the expected status")]
    InvalidProposalStatus,
    #[msg("voting window has not ended")]
    VotingNotEnded,
    #[msg("voting window has ended")]
    VotingEnded,
    #[msg("timelock has not elapsed")]
    TimelockNotElapsed,
    #[msg("execution window has expired")]
    ExecutionWindowExpired,
    #[msg("quorum was not met")]
    QuorumNotMet,
    #[msg("merkle proof is invalid")]
    MerkleProofInvalid,
    #[msg("merkle proof exceeds max depth")]
    MerkleProofTooDeep,
    #[msg("program registry is at capacity")]
    RegistryFull,
    #[msg("duplicate program in registry")]
    DuplicateProgram,
    #[msg("target program not found in registry")]
    ProgramNotRegistered,
    #[msg("arithmetic overflow")]
    ArithmeticOverflow,
    #[msg("ix_data exceeds max payload size for target program")]
    PayloadTooLarge,
    #[msg("proposal cannot be cancelled after voting starts")]
    CannotCancelAfterVoteStart,
    #[msg("metadata_uri is empty")]
    EmptyMetadataUri,
}
