use anchor_lang::prelude::*;

use crate::errors::AgentRegistryError;

pub const CIVIC_STATE_ACTIVE: u8 = 0;
pub const CIVIC_STATE_REVOKED: u8 = 1;
pub const CIVIC_STATE_FROZEN: u8 = 2;

// Lightweight decoder for Civic's `GatewayToken` account. Layout mirrors
// civic's on-chain record; we avoid pulling `solana-gateway` as a dep — a
// single on-chain program shouldn't carry that weight just to sanity-check
// a few bytes, and doing so would pin us to their release cadence.
//
// Layout (borsh, little-endian):
//   version          : u8
//   parent_token     : Option<Pubkey>       (1 + 0 or 32)
//   owner_wallet     : Pubkey               (32)
//   owner_identity   : Option<Pubkey>       (1 + 0 or 32)
//   gatekeeper_net   : Pubkey               (32)
//   issuing_gk       : Pubkey               (32)
//   state            : u8
//   expire_time      : Option<i64>          (1 + 0 or 8)
#[derive(Clone, Debug)]
pub struct GatewayToken {
    pub version: u8,
    pub owner_wallet: Pubkey,
    pub gatekeeper_network: Pubkey,
    pub issuing_gatekeeper: Pubkey,
    pub state: u8,
    pub expire_time: Option<i64>,
}

impl GatewayToken {
    pub fn decode(data: &[u8]) -> Result<Self> {
        let mut cur = 0usize;

        let version = read_u8(data, &mut cur)?;
        skip_option(data, &mut cur, 32)?; // parent_token
        let owner_wallet = read_pubkey(data, &mut cur)?;
        skip_option(data, &mut cur, 32)?; // owner_identity
        let gatekeeper_network = read_pubkey(data, &mut cur)?;
        let issuing_gatekeeper = read_pubkey(data, &mut cur)?;
        let state = read_u8(data, &mut cur)?;

        let has_expire = read_u8(data, &mut cur)?;
        let expire_time = match has_expire {
            0 => None,
            1 => Some(read_i64(data, &mut cur)?),
            _ => return err!(AgentRegistryError::GatewayTokenInvalid),
        };

        Ok(Self {
            version,
            owner_wallet,
            gatekeeper_network,
            issuing_gatekeeper,
            state,
            expire_time,
        })
    }

    pub fn assert_active(&self) -> Result<()> {
        match self.state {
            CIVIC_STATE_ACTIVE => Ok(()),
            CIVIC_STATE_REVOKED => err!(AgentRegistryError::GatewayTokenNotActive),
            CIVIC_STATE_FROZEN => err!(AgentRegistryError::GatewayTokenNotActive),
            _ => err!(AgentRegistryError::GatewayTokenInvalid),
        }
    }

    pub fn assert_unexpired(&self, now: i64) -> Result<i64> {
        match self.expire_time {
            None => Ok(0),
            Some(t) if t > now => Ok(t),
            _ => err!(AgentRegistryError::PersonhoodExpired),
        }
    }
}

fn read_u8(data: &[u8], cur: &mut usize) -> Result<u8> {
    if *cur >= data.len() {
        return err!(AgentRegistryError::GatewayTokenInvalid);
    }
    let v = data[*cur];
    *cur += 1;
    Ok(v)
}

fn read_i64(data: &[u8], cur: &mut usize) -> Result<i64> {
    if *cur + 8 > data.len() {
        return err!(AgentRegistryError::GatewayTokenInvalid);
    }
    let mut buf = [0u8; 8];
    buf.copy_from_slice(&data[*cur..*cur + 8]);
    *cur += 8;
    Ok(i64::from_le_bytes(buf))
}

fn read_pubkey(data: &[u8], cur: &mut usize) -> Result<Pubkey> {
    if *cur + 32 > data.len() {
        return err!(AgentRegistryError::GatewayTokenInvalid);
    }
    let mut buf = [0u8; 32];
    buf.copy_from_slice(&data[*cur..*cur + 32]);
    *cur += 32;
    Ok(Pubkey::new_from_array(buf))
}

fn skip_option(data: &[u8], cur: &mut usize, inner_len: usize) -> Result<()> {
    let tag = read_u8(data, cur)?;
    match tag {
        0 => Ok(()),
        1 => {
            if *cur + inner_len > data.len() {
                return err!(AgentRegistryError::GatewayTokenInvalid);
            }
            *cur += inner_len;
            Ok(())
        }
        _ => err!(AgentRegistryError::GatewayTokenInvalid),
    }
}

#[cfg(test)]
pub fn encode_test_token(
    owner: &Pubkey,
    network: &Pubkey,
    gatekeeper: &Pubkey,
    state: u8,
    expire_time: Option<i64>,
) -> Vec<u8> {
    let mut v = Vec::with_capacity(160);
    v.push(1); // version
    v.push(0); // parent_token = None
    v.extend_from_slice(owner.as_ref());
    v.push(0); // owner_identity = None
    v.extend_from_slice(network.as_ref());
    v.extend_from_slice(gatekeeper.as_ref());
    v.push(state);
    match expire_time {
        None => v.push(0),
        Some(t) => {
            v.push(1);
            v.extend_from_slice(&t.to_le_bytes());
        }
    }
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_active_token_ok() {
        let owner = Pubkey::new_unique();
        let net = Pubkey::new_unique();
        let gk = Pubkey::new_unique();
        let data = encode_test_token(&owner, &net, &gk, CIVIC_STATE_ACTIVE, Some(1_000));
        let tok = GatewayToken::decode(&data).unwrap();
        assert_eq!(tok.owner_wallet, owner);
        assert_eq!(tok.gatekeeper_network, net);
        assert_eq!(tok.issuing_gatekeeper, gk);
        assert_eq!(tok.state, CIVIC_STATE_ACTIVE);
        assert_eq!(tok.expire_time, Some(1_000));
        tok.assert_active().unwrap();
    }

    #[test]
    fn decode_truncated_data_errs() {
        let short = vec![1u8, 0, 1, 2, 3];
        assert!(GatewayToken::decode(&short).is_err());
    }

    #[test]
    fn decode_rejects_invalid_option_tag() {
        let owner = Pubkey::new_unique();
        let net = Pubkey::new_unique();
        let gk = Pubkey::new_unique();
        let mut data = encode_test_token(&owner, &net, &gk, CIVIC_STATE_ACTIVE, None);
        data[1] = 7; // corrupt parent_token Option tag
        assert!(GatewayToken::decode(&data).is_err());
    }

    #[test]
    fn frozen_and_revoked_rejected() {
        let owner = Pubkey::new_unique();
        let net = Pubkey::new_unique();
        let gk = Pubkey::new_unique();
        for state in [CIVIC_STATE_REVOKED, CIVIC_STATE_FROZEN] {
            let data = encode_test_token(&owner, &net, &gk, state, None);
            let tok = GatewayToken::decode(&data).unwrap();
            assert!(tok.assert_active().is_err());
        }
    }

    #[test]
    fn expiry_in_past_rejected() {
        let owner = Pubkey::new_unique();
        let net = Pubkey::new_unique();
        let gk = Pubkey::new_unique();
        let data = encode_test_token(&owner, &net, &gk, CIVIC_STATE_ACTIVE, Some(100));
        let tok = GatewayToken::decode(&data).unwrap();
        assert!(tok.assert_unexpired(200).is_err());
    }

    #[test]
    fn non_expiring_ok() {
        let owner = Pubkey::new_unique();
        let net = Pubkey::new_unique();
        let gk = Pubkey::new_unique();
        let data = encode_test_token(&owner, &net, &gk, CIVIC_STATE_ACTIVE, None);
        let tok = GatewayToken::decode(&data).unwrap();
        assert_eq!(tok.assert_unexpired(i64::MAX).unwrap(), 0);
    }
}
