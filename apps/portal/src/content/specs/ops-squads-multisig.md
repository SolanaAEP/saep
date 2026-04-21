# Spec — Squads Multisig Authority Model

**Owner:** lead maintainer
**Depends on:** deployed programs, governance surface, public authority inventory
**Blocks:** production authority handover for programs and mint extensions
**References:** backend PDF §2.6, backend PDF §5.1

> This document describes the public authority layout and verification surface for SAEP multisigs. Signer onboarding, custody procedures, backups, communications channels, and incident playbooks are intentionally excluded from this repository.

## Goal

Define which multisigs control which protocol surfaces, what thresholds they use, and what evidence the public repo must expose so third parties can verify that authority handover happened correctly.

## Authority split

1. **Upgrade council — 4-of-7.** Controls program upgrade authorities and other binary-change surfaces.
2. **Governance council — 6-of-9.** Controls parameter updates, verification-key rotations, and other governance-gated configuration changes.
3. **Emergency authority.** Controls the pause surfaces assigned to emergency response.

The upgrade and governance councils must remain disjoint at the signer-set level.

## Controlled surfaces

| Surface | Authority target |
|---|---|
| Program upgrade authority | Upgrade council |
| Protocol parameter changes | Governance council |
| Verification-key rotation | Governance council |
| Transfer-hook program authority | Governance-controlled authority surface |
| Mint pause / unpause | Emergency authority |
| Emergency program pause surfaces | Emergency authority or the program-specific authority recorded on-chain |

## Public artifacts

- The multisig addresses.
- The threshold for each multisig.
- The mapping from each controlled surface to its authority.
- The transaction signatures that performed authority handover.
- A post-handover authority inventory.

## Verification requirements

- Every critical program and mint-extension authority resolves to a multisig, a governance PDA, or `None`, as intended by the spec.
- The authority inventory matches the addresses configured on-chain.
- Upgrade and governance authorities are not collapsed onto the same signer set by accident.
- Any emergency surface can be identified from public artifacts without private context.

## Repository boundary

This repository may contain:

- Thresholds and authority mappings.
- Public multisig addresses.
- Transaction signatures and authority dumps.
- Public governance references.

This repository must not contain:

- Private signer contact details.
- Device or backup procedures.
- Maintainer-only escalation trees.
- Communications-channel instructions.
- Incident drill notes or rehearsal checklists.

## Done checklist

- [ ] Upgrade council address published
- [ ] Governance council address published
- [ ] Emergency authority address published where applicable
- [ ] Thresholds for each authority surface published
- [ ] Program-to-authority matrix published
- [ ] Handover transaction signatures published
- [ ] Post-handover authority inventory published
- [ ] Public record confirms no critical surface remains on an unconstrained EOA
