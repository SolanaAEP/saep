use anchor_lang::prelude::*;

#[event]
pub struct RegistryInitialized {
    pub authority: Pubkey,
}

#[event]
pub struct TagApproved {
    pub bit_index: u8,
    pub slug: [u8; 32],
    pub added_by: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct TagRetired {
    pub bit_index: u8,
    pub timestamp: i64,
}

#[event]
pub struct TagManifestUpdated {
    pub bit_index: u8,
}

#[event]
pub struct AuthorityTransferProposed {
    pub pending: Pubkey,
}

#[event]
pub struct AuthorityTransferAccepted {
    pub new_authority: Pubkey,
}

#[event]
pub struct PausedSet {
    pub paused: bool,
}
