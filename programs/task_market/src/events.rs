use anchor_lang::prelude::*;

#[event]
pub struct GlobalInitialized {
    pub authority: Pubkey,
    pub agent_registry: Pubkey,
    pub proof_verifier: Pubkey,
    pub fee_collector: Pubkey,
    pub solrep_pool: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct TaskCreated {
    pub task_id: [u8; 32],
    pub client: Pubkey,
    pub agent_did: [u8; 32],
    pub payment_amount: u64,
    pub deadline: i64,
    pub timestamp: i64,
}

#[event]
pub struct TaskFunded {
    pub task_id: [u8; 32],
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct TaskCancelled {
    pub task_id: [u8; 32],
    pub timestamp: i64,
}

#[event]
pub struct ResultSubmitted {
    pub task_id: [u8; 32],
    pub result_hash: [u8; 32],
    pub proof_key: [u8; 32],
    pub submitted_at: i64,
    pub timestamp: i64,
}

#[event]
pub struct TaskVerified {
    pub task_id: [u8; 32],
    pub dispute_window_end: i64,
    pub timestamp: i64,
}

#[event]
pub struct VerificationFailed {
    pub task_id: [u8; 32],
    pub timestamp: i64,
}

#[event]
pub struct TaskReleased {
    pub task_id: [u8; 32],
    pub agent_did: [u8; 32],
    pub operator: Pubkey,
    pub client: Pubkey,
    pub mint: Pubkey,
    pub agent_payout: u64,
    pub protocol_fee: u64,
    pub solrep_fee: u64,
    pub timestamp: i64,
}

#[event]
pub struct TaskExpired {
    pub task_id: [u8; 32],
    pub refund_amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct DisputeRaised {
    pub task_id: [u8; 32],
    pub client: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct GlobalParamsUpdated {
    pub timestamp: i64,
}

#[event]
pub struct PausedSet {
    pub paused: bool,
    pub timestamp: i64,
}

#[event]
pub struct BidBookOpened {
    pub task_id: [u8; 32],
    pub commit_end: i64,
    pub reveal_end: i64,
    pub bond_amount: u64,
}

#[event]
pub struct BidCommitted {
    pub task_id: [u8; 32],
    pub bidder: Pubkey,
    pub bond_paid: u64,
}

#[event]
pub struct BidRevealed {
    pub task_id: [u8; 32],
    pub bidder: Pubkey,
    pub amount: u64,
}

#[event]
pub struct BidBookClosed {
    pub task_id: [u8; 32],
    pub winner_agent: Option<Pubkey>,
    pub winner_amount: u64,
    pub reveal_count: u16,
}

#[event]
pub struct BidSlashed {
    pub task_id: [u8; 32],
    pub bidder: Pubkey,
    pub bond_amount: u64,
}

#[event]
pub struct TaskPayloadStored {
    pub task_id: [u8; 32],
    pub kind_discriminant: u8,
    pub capability_bit: u16,
}

#[event]
pub struct MintAccepted {
    pub mint: Pubkey,
    pub accept_flags: u32,
    pub hook_program: Option<Pubkey>,
    pub slot: u64,
    pub timestamp: i64,
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
