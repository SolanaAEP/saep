use anchor_lang::prelude::*;

use agent_registry::state::{PersonhoodAttestation, PersonhoodTier};
use capability_registry::state::{
    CapabilityTag, PERSONHOOD_TIER_BASIC, PERSONHOOD_TIER_NONE, PERSONHOOD_TIER_VERIFIED,
};

use crate::errors::TaskMarketError;

pub fn tier_from_u8(code: u8) -> Result<PersonhoodTier> {
    match code {
        PERSONHOOD_TIER_NONE => Ok(PersonhoodTier::None),
        PERSONHOOD_TIER_BASIC => Ok(PersonhoodTier::Basic),
        PERSONHOOD_TIER_VERIFIED => Ok(PersonhoodTier::Verified),
        _ => err!(TaskMarketError::Unauthorized),
    }
}

pub fn resolve_required_tier(
    payload_tier: PersonhoodTier,
    tag: Option<&CapabilityTag>,
) -> Result<PersonhoodTier> {
    let tag_tier = match tag {
        Some(t) => tier_from_u8(t.min_personhood_tier)?,
        None => PersonhoodTier::None,
    };
    Ok(payload_tier.max(tag_tier))
}

pub fn enforce_personhood(
    required_tier: PersonhoodTier,
    attestation: Option<&PersonhoodAttestation>,
    bidder: &Pubkey,
    now: i64,
) -> Result<()> {
    if required_tier == PersonhoodTier::None {
        return Ok(());
    }
    let a = attestation.ok_or(error!(TaskMarketError::PersonhoodRequired))?;
    require_keys_eq!(a.operator, *bidder, TaskMarketError::AttestationOperatorMismatch);
    require!(!a.revoked, TaskMarketError::PersonhoodRevoked);
    if a.expires_at != 0 {
        require!(now <= a.expires_at, TaskMarketError::PersonhoodExpired);
    }
    require!(a.tier >= required_tier, TaskMarketError::PersonhoodRequired);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mk_attestation(op: Pubkey, tier: PersonhoodTier, expires_at: i64) -> PersonhoodAttestation {
        PersonhoodAttestation {
            operator: op,
            provider: agent_registry::state::ProviderKind::Civic,
            tier,
            gatekeeper_network: Pubkey::default(),
            attestation_ref: [0u8; 32],
            attested_at: 0,
            expires_at,
            revoked: false,
            bump: 0,
        }
    }

    fn mk_tag(min_tier: u8) -> CapabilityTag {
        CapabilityTag {
            bit_index: 0,
            slug: [0u8; 32],
            manifest_uri: [0u8; 96],
            added_at: 0,
            added_by: Pubkey::default(),
            retired: false,
            min_personhood_tier: min_tier,
            bump: 0,
        }
    }

    #[test]
    fn resolve_takes_stricter_of_payload_and_tag() {
        let tag = mk_tag(PERSONHOOD_TIER_VERIFIED);
        assert_eq!(
            resolve_required_tier(PersonhoodTier::Basic, Some(&tag)).unwrap(),
            PersonhoodTier::Verified
        );
        let tag = mk_tag(PERSONHOOD_TIER_BASIC);
        assert_eq!(
            resolve_required_tier(PersonhoodTier::Verified, Some(&tag)).unwrap(),
            PersonhoodTier::Verified
        );
        assert_eq!(
            resolve_required_tier(PersonhoodTier::None, None).unwrap(),
            PersonhoodTier::None
        );
    }

    #[test]
    fn enforce_none_tier_ignores_missing_attestation() {
        enforce_personhood(PersonhoodTier::None, None, &Pubkey::new_unique(), 0).unwrap();
    }

    #[test]
    fn enforce_requires_attestation_when_tier_set() {
        assert!(
            enforce_personhood(PersonhoodTier::Basic, None, &Pubkey::new_unique(), 0).is_err()
        );
    }

    #[test]
    fn enforce_rejects_wrong_operator() {
        let bidder = Pubkey::new_unique();
        let other = Pubkey::new_unique();
        let a = mk_attestation(other, PersonhoodTier::Basic, 0);
        assert!(enforce_personhood(PersonhoodTier::Basic, Some(&a), &bidder, 0).is_err());
    }

    #[test]
    fn enforce_rejects_expired() {
        let bidder = Pubkey::new_unique();
        let a = mk_attestation(bidder, PersonhoodTier::Basic, 100);
        assert!(enforce_personhood(PersonhoodTier::Basic, Some(&a), &bidder, 200).is_err());
    }

    #[test]
    fn enforce_rejects_revoked() {
        let bidder = Pubkey::new_unique();
        let mut a = mk_attestation(bidder, PersonhoodTier::Basic, 0);
        a.revoked = true;
        assert!(enforce_personhood(PersonhoodTier::Basic, Some(&a), &bidder, 0).is_err());
    }

    #[test]
    fn enforce_rejects_tier_shortfall() {
        let bidder = Pubkey::new_unique();
        let a = mk_attestation(bidder, PersonhoodTier::Basic, 0);
        assert!(enforce_personhood(PersonhoodTier::Verified, Some(&a), &bidder, 0).is_err());
    }

    #[test]
    fn enforce_accepts_higher_tier_than_required() {
        let bidder = Pubkey::new_unique();
        let a = mk_attestation(bidder, PersonhoodTier::Verified, 0);
        enforce_personhood(PersonhoodTier::Basic, Some(&a), &bidder, 0).unwrap();
    }

    #[test]
    fn enforce_non_expiring_accepts_any_now() {
        let bidder = Pubkey::new_unique();
        let a = mk_attestation(bidder, PersonhoodTier::Basic, 0);
        enforce_personhood(PersonhoodTier::Basic, Some(&a), &bidder, i64::MAX).unwrap();
    }

    #[test]
    fn tier_from_u8_rejects_out_of_range() {
        assert!(tier_from_u8(99).is_err());
    }

    #[test]
    fn capability_tag_gating_promotes_from_none() {
        let tag = mk_tag(PERSONHOOD_TIER_VERIFIED);
        let r = resolve_required_tier(PersonhoodTier::None, Some(&tag)).unwrap();
        assert_eq!(r, PersonhoodTier::Verified);
    }
}
