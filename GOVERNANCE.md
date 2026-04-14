# Governance

SAEP has two governance surfaces: **off-chain** (this repo, roadmap, maintainers) and **on-chain** (program upgrade authority, protocol parameters). They are deliberately separated so that editorial decisions about the codebase cannot unilaterally move funds.

## Off-chain — the repository

### Roles

- **Contributor:** anyone who opens an issue or PR.
- **Maintainer:** commit access, can merge PRs, can approve security advisories. Listed in [MAINTAINERS.md](./MAINTAINERS.md) (added in M1).
- **Lead maintainer:** tiebreaker on disputed decisions, final call on spec ambiguity. Rotates annually.

### Decision making

- **Bug fixes, refactors, non-breaking changes:** one maintainer approval.
- **New features, breaking changes, new dependencies:** two maintainer approvals + a merged spec.
- **Security fixes:** fast-track — one maintainer review + lead maintainer sign-off, patched before public disclosure.
- **Stack changes, milestone scope changes:** discussion issue first, then PR. Lead maintainer can veto only with written reasoning.
- **Auditor selection, bounty sizing, token economics:** on-chain governance (see below) once `governance_program` is deployed. Until then, lead maintainer decides publicly.

Disputes that cannot be resolved by the maintainer group go to the lead maintainer. Disputes with the lead maintainer go to a simple majority vote of maintainers excluding the lead.

## On-chain — program upgrade authority

All seven programs have their upgrade authority assigned to a **Squads 4-of-7 multisig**. This is set at first deploy; no program ever deploys to mainnet with a single-key upgrade authority.

Signers:

- 3 core maintainers
- 2 independent technical advisors
- 2 external community representatives elected via `governance_program` after M2

Any upgrade requires:

1. PR merged to `main` with corresponding spec update.
2. Build reproducibility verified against the commit hash.
3. External audit report filed for the changes, if the change touches audit-scope code.
4. 4-of-7 multisig signatures.
5. Announcement posted at least 48 hours before execution, except for Critical security patches (see [SECURITY.md](./SECURITY.md)).

## On-chain — protocol parameters

Once `governance_program` is live (M2), protocol parameters (fee rates, stake minimums, dispute timers, slash percentages) move to on-chain governance:

- **Proposals:** any staked agent with reputation ≥ threshold can submit.
- **Voting:** token-weighted, quadratic; details in the program spec.
- **Quorum:** 10% of circulating supply.
- **Threshold:** simple majority for parameter tweaks, 66% for treasury spend above the delegated limit.
- **Timelock:** 48h for parameter changes, 7d for treasury actions.

Upgrade-authority multisig and governance program are intentionally distinct: governance cannot force an upgrade, and the multisig cannot bypass a governance-set parameter without a new upgrade + audit cycle.

## Slashing and dispute arbitration

Slashing occurs through `dispute_arbitration` (M2), never through a direct admin action. Every slash has a 30-day timelock during which the affected agent can appeal. See `specs/program-dispute-arbitration.md` when it lands.

## Trusted setup

The Groth16 trusted setup is a multi-party ceremony. Participant list is proposed by maintainers and confirmed by a governance vote before the ceremony begins. The full list, transcripts, and attestations are published under `circuits/ceremony/` once complete. Any program deploying against a VK derived from the ceremony must link to the exact commit and artifacts used.

## Changing this document

Amendments to this document require two maintainer approvals and a 7-day notice period. After M2, material changes additionally require a governance vote.
