# SAEP Bug Bounty

Reporter-facing terms for the SAEP responsible-disclosure program. Pre-launch, self-hosted: reports are accepted today via the channels in `SECURITY.md`, safe-harbor (§6) is active, payouts are funding-gated until the on-chain bounty pool (`fee_collector` revenue split) is ratified. Hall-of-fame credit is guaranteed regardless of payout status.

References:

- [`SECURITY.md`](./SECURITY.md) — disclosure channels, PGP, severity / response SLA, coordinated-disclosure timeline
- [`SECURITY-REVIEW.md`](./SECURITY-REVIEW.md) — internal-review folded into public substrate (publishing alongside this document)
- [`docs/audit/`](./docs/audit/) — milestone audit packages and freeze-tag references

---

## 1. Scope window

The program is phased so each milestone's program surface enters scope only after its mainnet activation.

| Phase | Window | Surface |
|---|---|---|
| Pre-launch | Today → mainnet launch | Reports accepted, safe-harbor honored, payout deferred to post-launch or paid ex-gratia at maintainer discretion. |
| v1 (M1 launch) | Mainnet launch + 30d | M1 programs (5) + portal + IACP + indexer. |
| v2 (M2 launch) | M2 launch + ongoing | Adds `dispute_arbitration` + `governance_program` + `fee_collector` + `nxs_staking`. |
| v3 (M3 launch) | M3 launch + ongoing | Adds Token-2022 SAEP mint extensions + Privacy Escrow path if shipped. |

Each phase expansion is announced via the `SECURITY.md` changelog and the official social channels.

---

## 2. In-scope assets

### 2.1 Smart contracts (v1, M1)

- `programs/capability_registry`
- `programs/agent_registry`
- `programs/task_market`
- `programs/treasury_standard`
- `programs/proof_verifier`

All at the frozen audit-of-record SHA recorded in `docs/audit/` for the relevant milestone. Changes landing after the freeze tag are covered only once re-audited or explicitly annotated as in-scope in `SECURITY.md`.

### 2.2 Off-chain services

- `services/indexer` (Rust, Diesel, Yellowstone gRPC)
- `services/iacp` (Node, WebSocket + REST, Redis Streams, on-chain anchor worker)
- `services/proof-gen` (circom artifacts + Groth16 prover)
- `services/discovery` (Discovery REST + WebSocket, webhook producer)
- Portal Next.js app (`apps/portal`) — SIWS auth, Jito bundle construction, RPC proxy, transaction builders in `packages/sdk`

### 2.3 Cryptography + circuits

- `circuits/task_completion` circom source and the committed dev-tier verifying key
- Poseidon hash construction, constraint correctness, soundness of reputation binding
- Trusted-setup ceremony protocol (per `specs/ops-trusted-setup.md`); individual ceremony participants' destroyed secrets are out-of-scope

### 2.4 Infrastructure (low-severity ceiling unless funds-at-risk)

- Vercel deployment config, Next.js route handlers, edge middleware
- Render Postgres (indexer), Render service config
- GitHub org config (branch protection, secrets scanning, signing keys)

### 2.5 Deliberately not yet in scope

- `programs/fee_collector`, `programs/governance_program`, `programs/dispute_arbitration`, `programs/nxs_staking`, `programs/template_registry` — scaffolds and partial deploys; add at M2 launch.
- Token-2022 SAEP mint extensions beyond the live minimal set (`metadataPointer`, `tokenMetadata`) — M3, add at M3 launch.
- A2A marketplace flows — M2 frontend.

---

## 3. Out of scope

No payout for the following, even if technically correct:

- **Audit findings already known.** Anything in the published audit reports for the relevant milestone (`docs/audit/`). Reporters are expected to read the audit report and the `SECURITY-REVIEW.md` finding ledger before submitting.
- **Stub-family behavior.** `pay_task` (fail-closed), `finalize_batch` (partial implementation), `raise_dispute` (terminal state until M2), `record_job_outcome` (caller-side severed), `verify_and_update_reputation` (disabled). These return controlled errors or emit-and-stop; reporting that they don't dispatch to a non-existent M2 surface is not a bug in M1.
- **Missing features.** A2A marketplace not implemented, dispute panel is M2, fee-collector mainnet broadcast pending — not in scope.
- **Theoretical / academic concerns.** bn254 security margin, Poseidon round sufficiency, Groth16 soundness against a broken CRS. We pay for exploits against our implementation of accepted primitives, not criticisms of the primitives.
- **Rate-limit / resource exhaustion that's already bounded.** The IACP rate limiter at default `20 burst / 5 msg/s` is doing its job; reporting "I sent 1000 req/s and got 429s" is not a bug.
- **TLS / DNS / hosting-config reports** without a demonstrated funds-at-risk or key-leak path. Run your scanner; it's a compliance report, not a vulnerability.
- **Self-DoS via the reporter's own account.** Burning your own stake, locking your own treasury, sending your own funds to a bad address — not a bug.
- **Social engineering, phishing, physical attacks, lost-device scenarios** against maintainers. Out of scope for payout; report to `security@buildonsaep.com` and we will rotate keys.
- **Third-party dependency issues** where the only fix is "wait for upstream". Exception: if we can mitigate locally (pin, patch, vendor) and the issue is reachable from our attack surface, the report is in-scope.
- **Devnet-only behavior** with no mainnet corollary.

---

## 4. Severity matrix

Severity is set by the maintainers at triage and may be revised during analysis. Tiers follow Immunefi's v2.3 severity classification system for Solana, with SAEP-specific anchors.

| Tier | Anchor | Examples |
|---|---|---|
| Critical | Manifest loss of user funds; permanent freeze of any PDA; mint authority compromise; permanent bypass of capability_mask, stake-slash, or VK rotation timelock | Drain of `taskEscrow` or `agent_vault` via any path; forge a valid Groth16 proof that settles a task without the circuit; bypass the 14-day upgrade timelock on `task_market` |
| High | Temporary freeze of user funds; incorrect settlement amount; bypass of slashing or reputation invariants; unintended privilege escalation that stops short of fund loss | Settle a task at a wrong amount via a rounding exploit; register as an agent without paying full stake; cancel another operator's bid |
| Medium | Griefing, unintended denial of service, on-chain-visible logic inconsistency with no direct funds-at-risk | Force a task through the 9-state machine in an undocumented order; exhaust BatchState PDAs faster than closable; cause silent truncation in an event emitted for indexer consumption |
| Low | Observability degradation, off-chain-only issues, information disclosure of non-sensitive data | Indexer decodes an event incorrectly; portal surfaces a confusing error; metrics label overflow |
| Informational | Defense-in-depth suggestions, documentation inaccuracies, hardening recommendations | "You could add an extra bound check here" when the current bound is already safe |

Severity × impact determines the payout tier (§5).

---

## 5. Payout ranges

**Status.** Payout ranges below are the **target at program launch**, benchmarked against Solana-ecosystem protocols of similar scope and TVL ambition. The on-chain bounty pool is funded by an explicit split of `fee_collector` revenue (an on-chain governance proposal will ratify the split percentage and rolling cap; until that proposal lands and `fee_collector` is initialised on mainnet, payouts are honored ex-gratia at maintainer discretion against currently-available protocol funds, with hall-of-fame credit guaranteed in all cases).

| Tier | Target range (USD) | Notes |
|---|---|---|
| Critical | $50,000 – $500,000 | Up to 10% of funds-at-risk, capped at $500K per report |
| High | $10,000 – $50,000 | Flat range; scale by novelty + reproducibility |
| Medium | $2,000 – $10,000 | Flat range |
| Low | $500 – $2,000 | Flat range; may be paid as swag/credit at maintainer discretion under $1K |
| Informational | $0 (hall-of-fame only) | Credit + SAEP-branded swag if opted in |

Bonus multipliers (applied after base tier):

- `1.25×` for a fully working PoC against devnet (vs theoretical writeup)
- `1.5×` for a novel attack class not flagged in prior audits
- `0.5×` if the report requires assumptions that aren't yet reachable in production (e.g., "if program X existed at M1, this would be an issue")

Payouts are in USDC to a wallet the reporter provides; fiat alternative on request at maintainer discretion subject to §8.

---

## 6. Safe-harbor

Good-faith security research on in-scope assets, conducted under the rules below, will not be subject to legal action by Appfact (CVR 33722605), and Appfact will make a good-faith effort to indemnify the researcher against third-party claims arising from the research, subject to §8.

**Permitted:**

- Testing against our devnet deployments and localnet.
- Static analysis, fuzzing, and formal verification of our public source.
- Reverse-engineering our binaries and circuits.
- Interacting with on-chain programs using the reporter's own accounts.

**Not permitted (bans safe-harbor):**

- Exploiting a live mainnet vulnerability beyond proof of existence. Confirm minimally, then report.
- Attacks against third-party dependencies (Helius, Render, Vercel, Jupiter, Pyth) or other protocols' production systems, even if pivoting from SAEP.
- Social engineering of maintainers, contributors, users, or auditors.
- Physical attacks on maintainer-owned hardware.
- Accessing, modifying, or exfiltrating user data beyond what's needed to demonstrate the bug.
- Publicly disclosing before the embargo ends (§9).
- Demanding payment as a precondition of disclosure — that is extortion, not research.

Safe-harbor covers research activity, not subsequent monetization of access. Finding a bug does not grant the right to keep exploiting it.

Jurisdiction is Denmark (Appfact seat). Researchers outside the EU should review whether their local computer-misuse statutes are compatible with this safe-harbor before testing. We cannot indemnify against foreign criminal prosecution.

---

## 7. Submission process

### 7.1 Channel

Primary: GitHub private security advisory at [github.com/SolanaAEP/saep/security/advisories/new](https://github.com/SolanaAEP/saep/security/advisories/new). This gives us a structured intake with CVE-minting support.

Fallback: `security@buildonsaep.com` (PGP fingerprint `0FE8 E47B C44A 599C 84ED BD37 3362 32E2 26C8 25A7`, key id `0x336232E226C825A7`, full key in `SECURITY-PGP-PUBLIC.asc`). Unencrypted email is accepted for initial contact only — we will ask to move to PGP before any technical detail is exchanged.

Do not: open a public GitHub issue, post on X / Twitter, Discord DM, or file via a third-party platform.

### 7.2 Required report fields

- Affected component + commit SHA (or freeze tag if M1).
- Severity self-assessment (we will verify).
- Reproduction: exact instructions against a reproducible environment (localnet preferred; devnet acceptable; mainnet explicitly forbidden beyond read-only confirmation).
- Impact analysis: funds-at-risk ceiling, privilege escalation reached, invariants broken.
- Suggested mitigation (optional, but bumps the multiplier).
- Reporter identity + payout wallet (or "hall of fame only").

### 7.3 Triage timeline

| Elapsed | Action |
|---|---|
| < 24h | Acknowledge receipt; assign internal id; page on-call if self-assessed Critical/High |
| < 72h | Severity + duplicate check; reporter notified of initial tier |
| < 14d (Critical/High) | Fix branch in private repo, internal review, auditor-of-record notified |
| < 30d (Medium/Low) | Fix merged (or decision to accept risk documented) |
| < 30d post-fix (all tiers) | Payout processed + public advisory |

Duplicates: the earliest-timestamped valid report wins. Later duplicates get an informational credit if they added material detail (a new PoC variant, a new attack chain).

---

## 8. Payout mechanics

- **Currency:** USDC on Solana mainnet, default. Fiat wire available for amounts > $10K on request, subject to Appfact's KYC requirements (§8.2). Hall-of-fame-only is always an option.
- **Timeline:** within 30 days of severity finalization + fix merge, whichever is later.
- **Vesting:** not used. Full payout at settlement.
- **No-claim clause:** payout is not contingent on a signed waiver of rights, but reporters accepting payout agree to the embargo (§9) and scope (§3) explicitly as a condition of the transfer.

### 8.1 Sanctions screening

Appfact is subject to EU sanctions law. Payouts to wallets or individuals on the OFAC SDN list, EU sanctions list, or UN consolidated list are not possible. If a report is legitimate but the reporter cannot receive payment, we will hold the hall-of-fame credit indefinitely and revisit if sanctions status changes.

### 8.2 KYC threshold

For reports paying out $10K or more, Appfact requires light KYC (government id + wallet attestation) per EU AML obligations. Under $10K, no KYC for crypto payouts. Hall-of-fame-only reporters are never KYC'd.

---

## 9. Embargo + disclosure

Default embargo: 90 days from triage confirmation, or 30 days from fix deploy, whichever is shorter. Extensions are negotiable case-by-case; reporters can always ask for a shorter window post-fix if the fix is clean and a public advisory would not be sensitive.

During embargo:

- No public disclosure by reporter or maintainers.
- Internal write-ups allowed at maintainer discretion (auditor, signers, insurance).
- Fix commits in public main describe the symptom neutrally — no PoC, no detailed vuln class, no attacker-useful detail.

Post-embargo:

- Joint public advisory on `SECURITY.md` + the GitHub security advisory + social channels + blog.
- Reporter credited in advisory unless they opt out.
- CVE minted if applicable.

Breaking embargo forfeits payout and safe-harbor. This is not negotiable.

---

## 10. Platform

Pre-launch: self-hosted via `security@buildonsaep.com` and the GitHub private-advisory flow. Zero platform fee, direct triage by maintainers. Suitable for current pre-launch volume.

At mainnet launch: migration to Immunefi (preferred) or HackerOne under evaluation, with a possible Sherlock / Code4rena-style time-boxed contest as a one-off pre-launch hardening pass. Platform changes will be announced with at least 14 days' notice on `SECURITY.md` and the social channels; no in-flight reports lose their priority during a migration.

---

## Hall of fame

Researchers who have responsibly disclosed issues are listed in `SECURITY.md` with their consent. Empty until the first valid report lands.
