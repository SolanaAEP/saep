# Spec — Squads Multisig Authority Model

**Owner:** lead maintainer
**Depends on:** deployed programs, governance surface, public authority inventory
**Blocks:** production authority handover for programs and mint extensions
**References:** [GOVERNANCE.md](../GOVERNANCE.md), [SECURITY.md](../SECURITY.md), backend PDF §2.6, backend PDF §5.1

> This document describes the public authority layout and verification surface for SAEP multisigs. Signer onboarding, custody procedures, backups, communications channels, and incident playbooks are intentionally excluded from this repository.

## Goal

Define which multisigs control which protocol surfaces, what thresholds they use, and what evidence the public repo must expose so third parties can verify that authority handover happened correctly.

## Authority split

SAEP uses separate multisig surfaces for distinct risks:

1. **Upgrade council — 4-of-7.** Controls program upgrade authorities and other binary-change surfaces.
2. **Governance council — 6-of-9.** Controls parameter updates, verification-key rotations, and other governance-gated configuration changes.
3. **Emergency authority.** Controls the pause surfaces assigned to emergency response. Where the same council is reused for emergency actions, that mapping must be explicit in the authority inventory.

The upgrade and governance councils must remain disjoint at the signer-set level. A single compromised signer must not help approach quorum on both surfaces.

## Controlled surfaces

| Surface | Authority target |
|---|---|
| Program upgrade authority | Upgrade council |
| IDL or release-adjacent governance metadata, when separately gated | Upgrade council or explicit release authority recorded on-chain |
| Protocol parameter changes | Governance council |
| Verification-key rotation | Governance council |
| Transfer-hook program authority | Governance-controlled PDA or governance council |
| Mint pause / unpause | Emergency authority |
| Emergency program pause surfaces | Emergency authority or the program-specific authority recorded on-chain |

No production surface should remain under an unconstrained externally owned account after handover.

## Public artifacts

The public repo or linked public release record must expose:

- The multisig addresses.
- The threshold for each multisig.
- The mapping from each controlled surface to its authority.
- The transaction signatures that performed authority handover.
- A machine-readable or human-readable authority inventory after handover.

If an authority rotates, the public inventory must be updated with the new address and rotation transaction.

## Verification requirements

The authority model is acceptable only if all of the following are true:

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

## Public verification flow

1. Enumerate the expected authority surfaces from the relevant specs.
2. Fetch the configured multisig or PDA addresses from the public inventory.
3. Read the on-chain accounts and verify the authority fields match.
4. Verify the handover or rotation transactions correspond to the published inventory.

## Done checklist

- [ ] Upgrade council address published
- [ ] Governance council address published
- [ ] Emergency authority address published where applicable
- [ ] Thresholds for each authority surface published
- [ ] Program-to-authority matrix published
- [ ] Handover transaction signatures published
- [ ] Post-handover authority inventory published
- [ ] Public record confirms no critical surface remains on an unconstrained EOA
