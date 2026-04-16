//! Builds the atomic ix bundle for a given IACP settlement trigger.
//!
//! The builder is deliberately **account-layout-agnostic**: the IACP trigger
//! event carries the already-resolved `AccountMeta` list (produced by the
//! task-lifecycle service, which knows the PDAs). The builder only
//! concatenates the discriminator + borsh args + accounts into the wire
//! `Instruction` shape, plus stitches in the always-bundle siblings per the
//! spec Affected-ix table.
//!
//! Why off-chain: PDA derivation belongs where state lives (the indexer +
//! task lifecycle services); the worker is a transport/tip/signing layer.

use std::convert::TryInto;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::programs::SAEP_PROGRAMS;

/// Solana `AccountMeta` equivalent — independent of solana-sdk so this
/// module stays lightweight. `pubkey` is raw 32-byte ed25519.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct AccountMeta {
    pub pubkey: [u8; 32],
    pub is_signer: bool,
    pub is_writable: bool,
}

/// Wire-level Solana instruction. Same shape as solana-sdk's but without
/// the crate dep. The worker's signing layer serialises a list of these
/// into an unsigned message + signs externally.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Instruction {
    pub program_id: [u8; 32],
    pub accounts: Vec<AccountMeta>,
    pub data: Vec<u8>,
}

#[derive(Debug, Error)]
pub enum TxBuilderError {
    #[error("program id not registered: {0}")]
    UnknownProgram(String),
    #[error("invalid pubkey: {0}")]
    InvalidPubkey(String),
    #[error("missing required field in trigger: {0}")]
    MissingField(&'static str),
}

/// Resolved program ids cached on the worker at startup.
#[derive(Clone, Debug)]
pub struct WorkerProgramIds {
    pub task_market: [u8; 32],
    pub fee_collector: [u8; 32],
    pub dispute_arbitration: [u8; 32],
    pub treasury_standard: [u8; 32],
    pub proof_verifier: [u8; 32],
    pub agent_registry: [u8; 32],
}

impl WorkerProgramIds {
    pub fn from_registry() -> Result<Self, TxBuilderError> {
        let find = |name: &str| -> Result<[u8; 32], TxBuilderError> {
            let entry = SAEP_PROGRAMS
                .iter()
                .find(|p| p.name == name)
                .ok_or_else(|| TxBuilderError::UnknownProgram(name.to_string()))?;
            decode_b58_pubkey(entry.id)
        };
        Ok(Self {
            task_market: find("task_market")?,
            fee_collector: find("fee_collector")?,
            dispute_arbitration: find("dispute_arbitration")?,
            treasury_standard: find("treasury_standard")?,
            proof_verifier: find("proof_verifier")?,
            agent_registry: find("agent_registry")?,
        })
    }
}

/// Decodes a base58 Solana pubkey into 32 bytes.
pub fn decode_b58_pubkey(s: &str) -> Result<[u8; 32], TxBuilderError> {
    bs58::decode(s)
        .into_vec()
        .ok()
        .and_then(|v| v.as_slice().try_into().ok())
        .ok_or_else(|| TxBuilderError::InvalidPubkey(s.to_string()))
}

/// Anchor discriminator = first 8 bytes of sha256("global:<ix_name>").
pub fn anchor_discriminator(ix_name: &str) -> [u8; 8] {
    let mut h = Sha256::new();
    h.update(format!("global:{ix_name}"));
    let digest = h.finalize();
    digest[..8].try_into().expect("sha256 digest >= 8 bytes")
}

/// Serialised Anchor ix data = discriminator || borsh(args). Callers with
/// no args pass an empty byte slice.
pub fn anchor_ix_data(ix_name: &str, args: &[u8]) -> Vec<u8> {
    let mut data = Vec::with_capacity(8 + args.len());
    data.extend_from_slice(&anchor_discriminator(ix_name));
    data.extend_from_slice(args);
    data
}

/// IACP trigger payload envelope. Producer-supplied resolved-account lists
/// per the affected ix. Any extra ix the spec mandates as always-bundled
/// (e.g. `fee_collector::collect_fee` with `release`) is listed in
/// `siblings`.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SettlementTrigger {
    /// `task.verified` → `task_market::release` + `fee_collector::collect_fee`.
    TaskVerified {
        task_id: String,
        payment_lamports: u64,
        primary: ResolvedIx,
        siblings: Vec<ResolvedIx>,
    },
    /// `task.disputed` → pause release; forward to dispute arbitration.
    TaskDisputed { task_id: String },
    /// `bid.reveal_ended` → `task_market::close_bidding` + refund losers.
    BidRevealEnded {
        task_id: String,
        primary: ResolvedIx,
        siblings: Vec<ResolvedIx>,
    },
}

impl SettlementTrigger {
    pub fn task_id(&self) -> Option<&str> {
        match self {
            Self::TaskVerified { task_id, .. }
            | Self::TaskDisputed { task_id, .. }
            | Self::BidRevealEnded { task_id, .. } => Some(task_id.as_str()),
        }
    }

    pub fn payment_lamports(&self) -> u64 {
        match self {
            Self::TaskVerified { payment_lamports, .. } => *payment_lamports,
            _ => 0,
        }
    }
}

/// Resolved-ix form carried in the IACP event. All accounts are base58
/// strings on the wire; decoded here into `AccountMeta`.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ResolvedIx {
    pub program_id: String,
    pub ix_name: String,
    #[serde(default)]
    pub accounts: Vec<ResolvedAccount>,
    /// Borsh-encoded args (hex). Empty for no-arg ix.
    #[serde(default)]
    pub args_hex: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ResolvedAccount {
    pub pubkey: String,
    #[serde(default)]
    pub is_signer: bool,
    #[serde(default)]
    pub is_writable: bool,
}

impl ResolvedIx {
    pub fn to_instruction(&self) -> Result<Instruction, TxBuilderError> {
        let program_id = decode_b58_pubkey(&self.program_id)?;
        let mut accounts = Vec::with_capacity(self.accounts.len());
        for a in &self.accounts {
            accounts.push(AccountMeta {
                pubkey: decode_b58_pubkey(&a.pubkey)?,
                is_signer: a.is_signer,
                is_writable: a.is_writable,
            });
        }
        let args = if self.args_hex.is_empty() {
            Vec::new()
        } else {
            hex::decode(&self.args_hex)
                .map_err(|e| TxBuilderError::MissingField("args_hex").tagged(e))?
        };
        Ok(Instruction {
            program_id,
            accounts,
            data: anchor_ix_data(&self.ix_name, &args),
        })
    }
}

/// Internal helper trait so we can chain `.tagged(...)` for readable errors.
trait ErrorTag {
    fn tagged(self, _src: impl std::fmt::Display) -> Self;
}
impl ErrorTag for TxBuilderError {
    fn tagged(self, _src: impl std::fmt::Display) -> Self {
        self
    }
}

pub struct TxBuilder {
    pub programs: WorkerProgramIds,
}

impl TxBuilder {
    pub fn new(programs: WorkerProgramIds) -> Self {
        Self { programs }
    }

    /// Expands a trigger into the ordered instruction list for one bundle.
    /// Returned list is 1..=MAX per trigger type. Caller slots the tip tx
    /// on top before sending.
    pub fn build(&self, trigger: &SettlementTrigger) -> Result<Vec<Instruction>, TxBuilderError> {
        match trigger {
            SettlementTrigger::TaskVerified {
                primary, siblings, ..
            } => {
                self.validate_program(&primary.program_id, &self.programs.task_market)?;
                let mut out = vec![primary.to_instruction()?];
                for s in siblings {
                    out.push(s.to_instruction()?);
                }
                Ok(out)
            }
            SettlementTrigger::BidRevealEnded {
                primary, siblings, ..
            } => {
                self.validate_program(&primary.program_id, &self.programs.task_market)?;
                let mut out = vec![primary.to_instruction()?];
                for s in siblings {
                    out.push(s.to_instruction()?);
                }
                Ok(out)
            }
            SettlementTrigger::TaskDisputed { .. } => Ok(Vec::new()),
        }
    }

    fn validate_program(&self, claimed_b58: &str, expected: &[u8; 32]) -> Result<(), TxBuilderError> {
        let got = decode_b58_pubkey(claimed_b58)?;
        if &got != expected {
            return Err(TxBuilderError::UnknownProgram(claimed_b58.to_string()));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discriminator_is_first_8_bytes_of_sha256() {
        let got = anchor_discriminator("release");
        let mut h = Sha256::new();
        h.update(b"global:release");
        let full = h.finalize();
        assert_eq!(&got[..], &full[..8]);
    }

    #[test]
    fn program_ids_decode_from_registry() {
        let ids = WorkerProgramIds::from_registry().unwrap();
        assert_ne!(ids.task_market, [0u8; 32]);
        assert_ne!(ids.fee_collector, [0u8; 32]);
        assert_ne!(ids.task_market, ids.fee_collector);
    }

    #[test]
    fn task_verified_expands_to_primary_plus_siblings() {
        let ids = WorkerProgramIds::from_registry().unwrap();
        let task_market_b58 = bs58::encode(ids.task_market).into_string();
        let fee_collector_b58 = bs58::encode(ids.fee_collector).into_string();
        let fake_acct = bs58::encode([9u8; 32]).into_string();

        let trigger = SettlementTrigger::TaskVerified {
            task_id: "t1".into(),
            payment_lamports: 5_000_000,
            primary: ResolvedIx {
                program_id: task_market_b58,
                ix_name: "release".into(),
                accounts: vec![ResolvedAccount {
                    pubkey: fake_acct.clone(),
                    is_signer: false,
                    is_writable: true,
                }],
                args_hex: String::new(),
            },
            siblings: vec![ResolvedIx {
                program_id: fee_collector_b58,
                ix_name: "collect_fee".into(),
                accounts: vec![ResolvedAccount {
                    pubkey: fake_acct,
                    is_signer: false,
                    is_writable: true,
                }],
                args_hex: String::new(),
            }],
        };

        let builder = TxBuilder::new(ids);
        let ixs = builder.build(&trigger).unwrap();
        assert_eq!(ixs.len(), 2);
        assert_eq!(&ixs[0].data[..8], &anchor_discriminator("release"));
        assert_eq!(&ixs[1].data[..8], &anchor_discriminator("collect_fee"));
    }

    #[test]
    fn task_disputed_is_a_noop_for_ix_list() {
        let ids = WorkerProgramIds::from_registry().unwrap();
        let builder = TxBuilder::new(ids);
        let ixs = builder
            .build(&SettlementTrigger::TaskDisputed {
                task_id: "t".into(),
            })
            .unwrap();
        assert!(ixs.is_empty());
    }

    #[test]
    fn rejects_primary_with_wrong_program_id() {
        let ids = WorkerProgramIds::from_registry().unwrap();
        let fake_acct = bs58::encode([1u8; 32]).into_string();
        let wrong_program = bs58::encode([2u8; 32]).into_string();
        let trigger = SettlementTrigger::TaskVerified {
            task_id: "t".into(),
            payment_lamports: 0,
            primary: ResolvedIx {
                program_id: wrong_program,
                ix_name: "release".into(),
                accounts: vec![ResolvedAccount {
                    pubkey: fake_acct,
                    is_signer: false,
                    is_writable: false,
                }],
                args_hex: String::new(),
            },
            siblings: Vec::new(),
        };
        let builder = TxBuilder::new(ids);
        assert!(builder.build(&trigger).is_err());
    }
}
