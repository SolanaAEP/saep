use anchor_lang::prelude::*;

#[error_code]
pub enum CapabilityRegistryError {
    #[msg("signer is not the registry authority")]
    Unauthorized,
    #[msg("registry already initialized")]
    AlreadyInitialized,
    #[msg("bit index must be < 128")]
    BitIndexOutOfRange,
    #[msg("tag already exists for this bit index")]
    TagAlreadyExists,
    #[msg("tag not found")]
    TagNotFound,
    #[msg("tag is retired")]
    TagRetired,
    #[msg("slug must be non-empty lowercase ascii [a-z0-9_] without leading or trailing underscore")]
    InvalidSlug,
    #[msg("manifest uri must be non-empty")]
    InvalidManifestUri,
    #[msg("mask contains unapproved or retired bits")]
    InvalidCapability,
    #[msg("registry is paused")]
    Paused,
    #[msg("no pending authority to accept")]
    NoPendingAuthority,
    #[msg("tag count overflow")]
    TagCountOverflow,
    #[msg("personhood tier value out of range")]
    InvalidPersonhoodTier,
}
