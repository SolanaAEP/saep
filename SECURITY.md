# Security Policy

SAEP is an audit-gated protocol. Anything that holds value — keys, funds, program upgrade authority, vote weight — is in scope for responsible disclosure.

## Supported versions

Pre-mainnet: all of `main` is in scope. There are no released versions yet.

Post-launch (M3+): the latest deployed program version per milestone, plus the previous version for 30 days after an upgrade.

## Reporting a vulnerability

**Do not** open a public GitHub issue for anything that could compromise funds, keys, or protocol integrity.

Two channels:

1. **GitHub private advisory** (preferred): [github.com/SolanaAEP/saep/security/advisories/new](https://github.com/SolanaAEP/saep/security/advisories/new)
2. **Email:** security@buildonsaep.com (PGP key TBD; request in first email if needed)

Include:

- Affected program(s), file paths, commit hash
- Impact: what can an attacker steal, freeze, or force
- Repro: minimal test case or transaction sequence
- Suggested fix, if you have one

We acknowledge within **48 hours** and share a triage outcome within **7 days**.

## Scope

### In scope

- Anchor programs in `programs/`
- Circom circuits in `circuits/`
- Token-2022 extension configuration (when deployed)
- Squads multisig configuration and upgrade flow
- Trusted-setup artifacts and verifying-key governance
- ProofVerifier public-input encoding
- Off-chain services that hold keys or signing authority (`services/indexer`, `services/iacp`, `services/proof-gen`) — any path from unauthenticated input to a signed transaction
- SDK instruction builders in `packages/sdk` — incorrect encoding that leads to loss-of-funds

### Out of scope

- Denial-of-service via RPC spam against our Helius node (contact Helius)
- UI bugs in the portal that don't affect signing or fund flow
- Spelling, documentation, rate limiting on public read-only endpoints
- Third-party vulnerabilities we depend on (Anchor, Solana, Squads, Light Protocol, Switchboard) — please report upstream
- Any attack that requires compromising a user's private keys or wallet client

## Severity and response SLA

| Severity | Examples | Response target | Fix target |
|---|---|---|---|
| Critical | Direct fund loss, unauthorized upgrade, state corruption, key extraction | 24h ack · 72h patch plan | 7d fix |
| High | Unauthorized state transition, economic griefing with real cost, proof forgery | 48h ack · 7d plan | 30d fix |
| Medium | Logic error without fund loss, auditable degradation | 7d ack | 60d fix |
| Low | Best-practice deviations, hardening opportunities | 14d ack | Rolling |

Severity is set by the SAEP maintainers after triage; reporters can dispute.

## Coordinated disclosure

Default timeline:

- **Day 0:** Private report received
- **Day ≤ 7:** Severity triaged, fix plan shared with reporter
- **Day ≤ 30 (Critical) / 60 (High):** Patched on all affected versions, multisig upgrade proposed
- **Day +14 after patch:** Public advisory published, reporter credited (unless anonymous preferred)

We won't sit on a valid report. If triage takes longer than the window above for reasons outside our control (audit firm scheduling, upstream dependency), we'll say so in writing.

## Bug bounty

TBD. A program will be announced before mainnet launch (M3). Reports filed during the pre-bounty window are honored retroactively for any bug that would have qualified.

## Audits

All audit reports will be published under [`reports/`](./reports) and linked from the README after release.

| Milestone | Auditor | Commit hash | Report |
|---|---|---|---|
| M1 | OtterSec | TBD | TBD |
| M2 | Neodyme | TBD | TBD |
| M3 | Halborn | TBD | TBD |

## Hall of fame

Researchers who have responsibly disclosed issues will be listed here with their consent.

_Empty — this is a fresh protocol. Find something first._
