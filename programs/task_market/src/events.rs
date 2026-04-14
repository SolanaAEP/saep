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
