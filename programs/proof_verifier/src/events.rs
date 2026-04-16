use anchor_lang::prelude::*;

#[event]
pub struct VerifierInitialized {
    pub authority: Pubkey,
}

#[event]
pub struct VkRegistered {
    pub vk_id: [u8; 32],
    pub circuit_label: [u8; 32],
    pub is_production: bool,
}

#[event]
pub struct VkActivationProposed {
    pub vk_id: [u8; 32],
    pub activates_at: i64,
}

#[event]
pub struct VkActivated {
    pub vk_id: [u8; 32],
}

#[event]
pub struct VkActivationCancelled {
    pub vk_id: [u8; 32],
}

#[event]
pub struct PausedSet {
    pub paused: bool,
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
pub struct BatchVerified {
    pub batch_id: [u8; 16],
    pub count: u8,
    pub vk_id: [u8; 32],
}

#[event]
pub struct GuardEntered {
    pub program: Pubkey,
    pub caller: Pubkey,
    pub slot: u64,
    pub stack_height: u16,
}

#[event]
pub struct ReentrancyRejected {
    pub program: Pubkey,
    pub offending_caller: Pubkey,
    pub slot: u64,
}
