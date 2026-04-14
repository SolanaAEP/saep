use anchor_lang::prelude::*;

pub const MAX_PUBLIC_INPUTS: u8 = 16;
pub const MAX_IC_LEN: usize = (MAX_PUBLIC_INPUTS as usize) + 1;
pub const VK_ROTATION_TIMELOCK_SECS: i64 = 7 * 24 * 60 * 60;

pub const BN254_FIELD_MODULUS_BE: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29,
    0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x97, 0x81, 0x6a, 0x91, 0x68, 0x71, 0xca, 0x8d,
    0x3c, 0x20, 0x8c, 0x16, 0xd8, 0x7c, 0xfd, 0x47,
];

#[account]
#[derive(InitSpace)]
pub struct VerifierConfig {
    pub authority: Pubkey,
    pub pending_authority: Option<Pubkey>,
    pub active_vk: Pubkey,
    pub pending_vk: Option<Pubkey>,
    pub pending_activates_at: i64,
    pub paused: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct VerifierKey {
    pub vk_id: [u8; 32],
    pub alpha_g1: [u8; 64],
    pub beta_g2: [u8; 128],
    pub gamma_g2: [u8; 128],
    pub delta_g2: [u8; 128],
    #[max_len(MAX_IC_LEN)]
    pub ic: Vec<[u8; 64]>,
    pub num_public_inputs: u8,
    pub circuit_label: [u8; 32],
    pub is_production: bool,
    pub registered_at: i64,
    pub registered_by: Pubkey,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct GlobalMode {
    pub is_mainnet: bool,
    pub bump: u8,
}

pub fn scalar_in_field(scalar_be: &[u8; 32]) -> bool {
    for i in 0..32 {
        match scalar_be[i].cmp(&BN254_FIELD_MODULUS_BE[i]) {
            std::cmp::Ordering::Less => return true,
            std::cmp::Ordering::Greater => return false,
            std::cmp::Ordering::Equal => continue,
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zero_is_in_field() {
        assert!(scalar_in_field(&[0u8; 32]));
    }

    #[test]
    fn modulus_itself_not_in_field() {
        assert!(!scalar_in_field(&BN254_FIELD_MODULUS_BE));
    }

    #[test]
    fn modulus_minus_one_in_field() {
        let mut m = BN254_FIELD_MODULUS_BE;
        m[31] -= 1;
        assert!(scalar_in_field(&m));
    }

    #[test]
    fn above_modulus_rejected() {
        let mut m = BN254_FIELD_MODULUS_BE;
        m[0] = m[0].saturating_add(1);
        assert!(!scalar_in_field(&m));
    }
}
