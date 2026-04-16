use anchor_lang::prelude::*;

use crate::errors::CapabilityRegistryError;

pub const MAX_TAGS: u8 = 128;
pub const SLUG_LEN: usize = 32;
pub const MANIFEST_URI_LEN: usize = 96;

#[account]
#[derive(InitSpace)]
pub struct RegistryConfig {
    pub authority: Pubkey,
    pub approved_mask: u128,
    pub tag_count: u8,
    pub pending_authority: Option<Pubkey>,
    pub paused: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct CapabilityTag {
    pub bit_index: u8,
    pub slug: [u8; SLUG_LEN],
    pub manifest_uri: [u8; MANIFEST_URI_LEN],
    pub added_at: i64,
    pub added_by: Pubkey,
    pub retired: bool,
    // Minimum personhood tier (mirrors agent_registry::state::PersonhoodTier)
    // required to bid on tasks gated by this capability. 0 = None, 1 = Basic,
    // 2 = Verified. Encoded as u8 to avoid a CPI-level type dep on agent_registry.
    pub min_personhood_tier: u8,
    pub bump: u8,
}

pub const PERSONHOOD_TIER_NONE: u8 = 0;
pub const PERSONHOOD_TIER_BASIC: u8 = 1;
pub const PERSONHOOD_TIER_VERIFIED: u8 = 2;

pub fn validate_slug(slug: &[u8; SLUG_LEN]) -> Result<()> {
    let end = slug.iter().position(|&b| b == 0).unwrap_or(SLUG_LEN);
    if end == 0 {
        return err!(CapabilityRegistryError::InvalidSlug);
    }
    let body = &slug[..end];
    if body[0] == b'_' || body[end - 1] == b'_' {
        return err!(CapabilityRegistryError::InvalidSlug);
    }
    for &b in body {
        let ok = matches!(b, b'a'..=b'z' | b'0'..=b'9' | b'_');
        if !ok {
            return err!(CapabilityRegistryError::InvalidSlug);
        }
    }
    if slug[end..].iter().any(|&b| b != 0) {
        return err!(CapabilityRegistryError::InvalidSlug);
    }
    Ok(())
}

pub fn validate_manifest_uri(uri: &[u8; MANIFEST_URI_LEN]) -> Result<()> {
    if uri[0] == 0 {
        return err!(CapabilityRegistryError::InvalidManifestUri);
    }
    Ok(())
}

pub fn bit_mask(bit_index: u8) -> Result<u128> {
    if bit_index >= MAX_TAGS {
        return err!(CapabilityRegistryError::BitIndexOutOfRange);
    }
    Ok(1u128 << bit_index)
}

impl RegistryConfig {
    pub fn set_bit(&mut self, bit_index: u8) -> Result<()> {
        let m = bit_mask(bit_index)?;
        self.approved_mask |= m;
        Ok(())
    }

    pub fn clear_bit(&mut self, bit_index: u8) -> Result<()> {
        let m = bit_mask(bit_index)?;
        self.approved_mask &= !m;
        Ok(())
    }

    pub fn assert_mask_approved(&self, mask: u128) -> Result<()> {
        if (mask & !self.approved_mask) != 0 {
            return err!(CapabilityRegistryError::InvalidCapability);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn slug_from(s: &str) -> [u8; SLUG_LEN] {
        let mut out = [0u8; SLUG_LEN];
        out[..s.len()].copy_from_slice(s.as_bytes());
        out
    }

    #[test]
    fn slug_accepts_valid_lowercase() {
        assert!(validate_slug(&slug_from("code_gen")).is_ok());
        assert!(validate_slug(&slug_from("a")).is_ok());
        assert!(validate_slug(&slug_from("retrieval_rag")).is_ok());
        assert!(validate_slug(&slug_from("inference_generic")).is_ok());
    }

    #[test]
    fn slug_rejects_empty() {
        assert!(validate_slug(&[0u8; SLUG_LEN]).is_err());
    }

    #[test]
    fn slug_rejects_uppercase() {
        assert!(validate_slug(&slug_from("CodeGen")).is_err());
    }

    #[test]
    fn slug_rejects_edge_underscores() {
        assert!(validate_slug(&slug_from("_code")).is_err());
        assert!(validate_slug(&slug_from("code_")).is_err());
    }

    #[test]
    fn slug_rejects_bad_chars() {
        assert!(validate_slug(&slug_from("code-gen")).is_err());
        assert!(validate_slug(&slug_from("code gen")).is_err());
        assert!(validate_slug(&slug_from("code.gen")).is_err());
    }

    #[test]
    fn slug_rejects_embedded_null_then_garbage() {
        let mut s = slug_from("code");
        s[10] = b'x';
        assert!(validate_slug(&s).is_err());
    }

    #[test]
    fn manifest_uri_rejects_empty() {
        assert!(validate_manifest_uri(&[0u8; MANIFEST_URI_LEN]).is_err());
    }

    #[test]
    fn manifest_uri_accepts_any_nonempty() {
        let mut u = [0u8; MANIFEST_URI_LEN];
        u[..3].copy_from_slice(b"ar:");
        assert!(validate_manifest_uri(&u).is_ok());
    }

    #[test]
    fn bit_mask_out_of_range() {
        assert!(bit_mask(128).is_err());
        assert!(bit_mask(200).is_err());
    }

    #[test]
    fn bit_mask_boundary() {
        assert_eq!(bit_mask(0).unwrap(), 1);
        assert_eq!(bit_mask(127).unwrap(), 1u128 << 127);
    }

    fn empty_config() -> RegistryConfig {
        RegistryConfig {
            authority: Pubkey::default(),
            approved_mask: 0,
            tag_count: 0,
            pending_authority: None,
            paused: false,
            bump: 0,
        }
    }

    #[test]
    fn set_and_clear_bit_roundtrip() {
        let mut c = empty_config();
        c.set_bit(3).unwrap();
        c.set_bit(31).unwrap();
        assert_eq!(c.approved_mask, (1u128 << 3) | (1u128 << 31));
        c.clear_bit(3).unwrap();
        assert_eq!(c.approved_mask, 1u128 << 31);
    }

    #[test]
    fn assert_mask_approved_allows_subset() {
        let mut c = empty_config();
        for b in 0..32 {
            c.set_bit(b).unwrap();
        }
        assert!(c.assert_mask_approved(0).is_ok());
        assert!(c.assert_mask_approved((1u128 << 32) - 1).is_ok());
        assert!(c.assert_mask_approved(1u128 << 5).is_ok());
    }

    #[test]
    fn assert_mask_approved_rejects_unapproved() {
        let mut c = empty_config();
        c.set_bit(0).unwrap();
        assert!(c.assert_mask_approved(1u128 << 1).is_err());
        assert!(c.assert_mask_approved((1u128 << 0) | (1u128 << 2)).is_err());
    }

    #[test]
    fn assert_mask_approved_rejects_retired_bits() {
        let mut c = empty_config();
        c.set_bit(0).unwrap();
        c.set_bit(1).unwrap();
        c.clear_bit(1).unwrap();
        assert!(c.assert_mask_approved(1u128 << 1).is_err());
    }
}
