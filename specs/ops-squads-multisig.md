# Spec — Squads Multisig Provisioning (Ops)

**Owner:** ops + lead maintainer
**Depends on:** all M1 programs deployed to devnet with a temporary deployer-controlled upgrade authority; audit sign-off from OtterSec
**Blocks:** mainnet deploy (M2+)
**References:** [GOVERNANCE.md](../GOVERNANCE.md), [SECURITY.md](../SECURITY.md), backend PDF §2.6 (14-day timelock on critical programs), §5.1 (Upgrade Safety)

> **This spec is for execution AFTER audit sign-off.** No mainnet upgrade-authority transfer occurs before OtterSec closes out M1 findings. Devnet rehearsal is explicitly in scope and should happen at least twice before mainnet day.

## Goal

Stand up two Squads v4 multisigs that jointly control SAEP's on-chain surface:

1. **Upgrade multisig — 4-of-7.** Program upgrade authority for every M1 program (`agent_registry`, `capability_registry`, `treasury_standard`, `task_market`, `proof_verifier`, plus `iacp_registry` and `reserved_seven` when they land). Covers binary upgrades, IDL upgrades, and `set-upgrade-authority` rotations.
2. **Governance multisig — 6-of-9.** Signs governance-gated instructions: capability-registry tag additions/retirements, treasury parameter updates (fee bps, whitelist changes), slash ratifications on M2 `dispute_arbitration`, verifying-key rotation on `proof_verifier`.

The two multisigs are intentionally separate and have non-overlapping signer sets. Governance cannot ship an upgrade; the upgrade multisig cannot bypass a governance-set parameter without a new upgrade + audit cycle (per [GOVERNANCE.md](../GOVERNANCE.md)).

## 1. Participant selection

### 1.1 Upgrade multisig (7 signers)

Per GOVERNANCE.md: 3 core maintainers, 2 independent technical advisors, 2 community representatives. Until the community reps are elected via `governance_program` (M2), the two seats are held by invited external engineers with no SAEP equity or token allocation, rotating if a governance election displaces them.

Selection criteria — every signer must meet all:

- **Geographic distribution:** no more than 2 signers in the same legal jurisdiction; minimum 3 timezones represented; at least one signer in the UTC-8 to UTC-5 band and at least one in UTC+0 to UTC+3.
- **Key-management hygiene:** demonstrated prior use of hardware-wallet custody for non-trivial value; passes a 30-minute interview covering seed backup, passphrase protection, and device-loss procedure.
- **Response-time SLA:** commits to acknowledging signing requests within **6 hours** on weekdays and **24 hours** on weekends, with a documented on-call handoff for travel or illness.
- **No organizational overlap:** no two signers employed by or advising the same company, VC fund, or DAO treasury.
- **Conflict disclosure:** signed conflict-of-interest declaration, refreshed annually; re-disclosed before each upgrade vote.

### 1.2 Governance multisig (9 signers)

Larger quorum reflects the broader permission surface. Composition target:

- 3 core maintainers (**disjoint from the upgrade multisig** — a person cannot hold both a core upgrade seat and a core governance seat)
- 2 independent cryptographers or protocol researchers
- 2 agent-operator representatives (staked agents with reputation above the participation threshold, once `governance_program` is live)
- 2 community/ecosystem representatives

Same jurisdiction, timezone, SLA, and conflict rules apply. Response SLA for governance actions is relaxed to **12 hours weekday / 48 hours weekend** because changes are parameter-scoped, not emergency upgrades.

### 1.3 Explicit disjointness rule

A signer on multisig A may not simultaneously be a signer on multisig B. This is a hard constraint verified at onboarding. Rationale: prevents a single compromised individual from approaching quorum on both surfaces.

## 2. Key-ceremony prep

Two weeks before the ceremony:

- **Hardware:** each signer receives (or confirms ownership of) **two** YubiKey 5 series devices — one primary, one sealed backup stored in a separate physical location. YubiKey firmware version is pinned and recorded.
- **Wallet:** signers use a Solana-compatible hardware wallet (Ledger Nano X / S Plus) as the signing device. The YubiKey is the second factor gating access to the Squads web app and to any online signing UI.
- **Offline signing preference:** where Squads supports offline transaction construction and signature export (see §3 links), signers sign offline by default. Online signing is acceptable only for non-sensitive governance actions (e.g. capability-tag proposals) and is logged.
- **Backup protocol:**
  - Seed phrase written on steel plate (Cryptosteel or equivalent), stored in a bank safe-deposit box or equivalent bonded vault.
  - Passphrase (BIP39 25th word) memorized and also written on a separate plate stored in a second vault.
  - No digital copy. No photograph. No cloud backup.
  - Recovery test: before ceremony day, each signer performs a full wipe-and-restore on their primary device from the steel backup, then confirms the derived address matches.
- **Communication channels:** Signal group (end-to-end encrypted) for coordination; a dedicated GPG keyring for signed artifacts. Signers publish their GPG fingerprints in `MAINTAINERS.md` before the ceremony.
- **Ceremony rehearsal:** full dry-run on devnet at least 14 days before mainnet day, covering every procedure in §§3–6.

## 3. Squads v4 bring-up

SAEP uses Squads Protocol v4 on Solana. The exact CLI surface for Squads has evolved; rather than fabricate flags, operators should follow the current docs:

- Squads docs: https://docs.squads.so/
- Squads v4 program repository: https://github.com/Squads-Protocol/v4
- Web app: https://v4.squads.so/

### 3.1 Devnet bring-up (rehearsal)

On devnet, using the Squads v4 web app or `@sqds/sdk`:

1. Create the upgrade multisig:
   - Threshold: 4-of-7
   - Members: paste the seven signer pubkeys (from §1.1)
   - Enable timelock feature (§5) with a 14-day delay
   - Time-lock authority: the multisig itself (no external bypass)
2. Create the governance multisig with threshold 6-of-9 and no timelock (governance changes have their own program-side timelock via `governance_program` in M2; for M1 governance actions, the proposal-to-execution window is announced manually per GOVERNANCE.md).
3. Record both multisig addresses in `infra/multisig.toml` (new file, just the pubkeys + threshold + member list — no secrets).
4. Fund each multisig vault with ~1 SOL on devnet for rent + transaction fees.

### 3.2 Mainnet bring-up

Identical flow on mainnet once audit sign-off lands. The mainnet ceremony is video-recorded (internal, not public) for post-hoc review. Every signer confirms their pubkey on-camera via their hardware device's address-display feature before it is added.

## 4. Transferring program upgrade authority

For each program in `programs/`, the sequence below runs **exactly once** per program. Do one program at a time; do not batch.

### 4.1 Pre-transfer sanity

```bash
# confirm current upgrade authority is still the deployer keypair
solana program show <program_id> --url mainnet-beta

# confirm the program's on-chain hash matches the audited commit
solana program dump <program_id> /tmp/onchain.so --url mainnet-beta
sha256sum /tmp/onchain.so
# compare against reports/<program>-anchor.md recorded hash
```

Abort if either check fails.

### 4.2 Transfer

```bash
# transfer to the upgrade multisig vault pubkey (NOT the multisig account itself — Squads v4 uses a PDA vault)
solana program set-upgrade-authority \
  <program_id> \
  --new-upgrade-authority <upgrade_multisig_vault_pubkey> \
  --skip-new-upgrade-authority-signer-check \
  --url mainnet-beta
```

Rationale for `--skip-new-upgrade-authority-signer-check`: the new authority is a PDA that cannot sign the setter transaction; the check is intentionally bypassed. This is the standard Solana BPF upgrade-authority-to-PDA handoff.

### 4.3 Confirm + propose a self-test upgrade

1. `solana program show <program_id>` should now list the multisig vault as the upgrade authority.
2. Immediately propose a **no-op upgrade** (re-deploy the same binary) via Squads to confirm the multisig can actually authorize an upgrade. This is a trivial test but catches misconfiguration before any real upgrade is blocked.
3. 4 signers approve. Timelock starts. **Wait the full 14 days** — do not shortcut. Execute. Verify the program's on-chain hash is unchanged (it should match because the binary is identical).
4. Record the test-upgrade transaction signatures in `reports/ops-multisig.md`.

### 4.4 Per-program tracking

| Program | Authority-transfer tx | Test-upgrade tx | Verified on-chain |
|---|---|---|---|
| `capability_registry` | | | |
| `agent_registry` | | | |
| `treasury_standard` | | | |
| `task_market` | | | |
| `proof_verifier` | | | |

Fill in during execution. Every row must be green before M2 work begins against these programs.

## 5. Timelock — 14 days

Per GOVERNANCE.md and backend PDF §2.6, upgrades to critical-path programs (task_market, treasury_standard, proof_verifier) carry a 14-day timelock. Two options exist:

### Option A — Squads-level timelock (recommended for M1)

Squads v4 supports a per-multisig time-lock feature. The upgrade multisig is configured with a 14-day delay at creation. Once quorum approves a proposal, it enters a queued state; execution is permissionless but cannot fire before the delay elapses.

**Pros:** program code stays simple; the delay applies uniformly to all upgrades; operators and community can observe the queued proposal during the window.

**Cons:** enforcement relies on the Squads program being correctly configured; a future Squads upgrade authority change could in principle remove the delay (mitigated by §1.3 disjointness and by publishing the multisig config hash).

### Option B — Program-side timelock

Each critical program would carry an `upgrade_queued_at: i64` field and reject `upgrade` instructions until `now - queued_at >= 14 days`. This pushes enforcement into audited program code.

**Pros:** cannot be bypassed by a Squads misconfiguration; reviewable by auditors.

**Cons:** adds state and complexity to every critical program; non-uniform (each program's timelock is independently configured); Solana BPF upgrade path doesn't naturally expose the hook — would require a custom upgrade wrapper program.

### Recommendation

**Option A for M1.** Squads v4's timelock is in scope of M2's Neodyme audit via configuration review (not code, since it's Squads code). The upgrade multisig config (members, threshold, timelock seconds) is committed to `infra/multisig.toml` and any change to it is itself a multisig-approved transaction, so the timelock cannot be silently shortened.

Revisit Option B for M3 or later if the audit firm flags the dependency on Squads.

## 6. Governance program hookup

For M1, the governance program is not yet deployed (lands in M2 per the overview). Governance-gated instructions in M1 programs are hardcoded to check `authority == MarketGlobal.governance` or equivalent; `governance` is set to the governance multisig vault at deployment.

M1 governance-gated instructions:

| Program | Instruction | Multisig |
|---|---|---|
| `capability_registry` | `add_tag`, `retire_tag` | governance 6-of-9 |
| `treasury_standard` | `set_protocol_params`, `set_fee_collector` | governance 6-of-9 |
| `task_market` | `set_allowed_mint`, `set_fees`, `set_paused` | governance 6-of-9 |
| `proof_verifier` | `rotate_vk` | governance 6-of-9 |
| (all) | program binary upgrade, IDL upgrade | upgrade 4-of-7 |

`set_paused` is the one instruction that may also be delegated to a smaller "emergency pause" multisig in M2 (e.g. 2-of-5) to enable faster incident response. Out of M1 scope; flagged as open question.

When `governance_program` ships in M2, these hardcoded authority fields migrate to proposal-gated execution. The governance multisig becomes one of several voting entities alongside token holders.

## 7. Emergency procedures

### 7.1 Compromised signer

If a signer reports key compromise or device loss:

1. The signer immediately posts a signed message (GPG, with their ceremony-registered key) to the maintainer Signal group stating the fact and timestamp.
2. Remaining signers treat the compromised key as adversarial: no approvals are counted from it starting immediately.
3. Within 24 hours, the remaining signers propose a Squads `memberRemove` + `memberAdd` transaction rotating the compromised signer out. A replacement is chosen per §1 criteria; if none is ready, the slot remains empty — quorum math shifts (e.g. 4-of-6 is temporarily stricter than 4-of-7 but still valid).
4. The transaction goes through the normal multisig flow. Because it doesn't touch program upgrade authority, the 14-day timelock does not apply (if on a non-timelocked governance multisig) or does apply (if on the upgrade multisig — accept the delay; a compromised signer can't reach quorum alone).
5. Post-rotation: publish a security advisory per SECURITY.md. Audit log appended to `reports/ops-multisig.md`.

If a compromised signer holds a key that, combined with other compromises, could reach quorum: see §7.2.

### 7.2 Quorum loss / simultaneous compromise

"Quorum loss" = enough signers are unreachable or compromised that the remaining honest set cannot reach threshold.

Upgrade multisig 4-of-7: loss of 4 signers → honest 3 cannot upgrade.
Governance multisig 6-of-9: loss of 4 signers → honest 5 cannot act.

This is an emergency. Procedure:

1. Lead maintainer calls an emergency maintainer meeting within 24 hours.
2. Pause affected programs if possible (requires governance quorum — if that is also lost, see §7.3).
3. Prepare a signed public advisory: protocol state, which keys are suspect, which funds are at risk.
4. If the compromise is adversarial (keys in attacker hands), the honest signers cannot recover by themselves — the attacker holds quorum. The only backstop is that **the upgrade multisig cannot drain escrows directly** (it can only upgrade program code; new code takes 14 days to land due to timelock). This is the intended property. Use the 14-day window to:
   - Socially coordinate users to exit funds from affected vaults.
   - Prepare a fork / redeploy with a fresh upgrade authority.
   - File legal/law-enforcement reports if funds are stolen.
5. If keys are merely lost (not in adversary hands): no recovery is possible for the lost slot; we live with reduced quorum until `memberAdd` via a higher-threshold one-off proposal (documented at multisig creation — see open question in §10).

### 7.3 Full upgrade-multisig compromise

If 4+ upgrade-multisig keys are confirmed adversarial-controlled simultaneously:

- The protocol is considered hostile-upgrade-capable at T+14 days.
- Public advisory goes out immediately with clear "exit funds before T+14d" guidance.
- Maintainers prepare a fork redeploy with fresh authority. Community coordinates migration.
- This is a worst-case scenario; the 14-day timelock buys the exit window. Without it, funds would be instantly drainable via a malicious upgrade.

This is why the timelock is non-negotiable and why the disjointness rule in §1.3 matters.

## 8. Post-setup verification checklist

Run after every multisig change (initial setup, signer rotation, threshold change):

```bash
# verify upgrade authority on every program
for pid in <program_ids>; do
  solana program show "$pid" --url mainnet-beta | grep "Upgrade Authority"
done
```

All must report the upgrade multisig vault pubkey.

```bash
# verify multisig configuration via Squads SDK or web app
# - member list matches MAINTAINERS.md
# - threshold matches GOVERNANCE.md
# - timelock matches (upgrade multisig only)
```

- [ ] Upgrade multisig threshold = 4; members = 7; timelock = 14 days
- [ ] Governance multisig threshold = 6; members = 9; timelock = none
- [ ] No signer appears on both multisigs
- [ ] `MAINTAINERS.md` lists every signer with their GPG fingerprint and public Solana pubkey
- [ ] `infra/multisig.toml` committed with vault addresses, member pubkeys, thresholds
- [ ] Test upgrade (§4.3) completed for every program; on-chain hash unchanged
- [ ] Video recording of ceremony archived to encrypted team storage
- [ ] Public announcement posted with multisig addresses and explorer links
- [ ] At least one devnet rehearsal completed within 14 days of mainnet day

## 9. Done-checklist

- [ ] Both multisigs created on devnet; full rehearsal completed twice
- [ ] OtterSec M1 audit signed off
- [ ] Both multisigs created on mainnet; video archived
- [ ] Program upgrade authority transferred for every M1 program
- [ ] Per-program test upgrade completed and verified
- [ ] Governance-gated instructions' authority fields set to governance multisig vault
- [ ] §8 verification checklist fully green
- [ ] `reports/ops-multisig.md` written: addresses, txs, ceremony timeline, any deviations
- [ ] Advisory published: addresses, signers (names + affiliations), explorer links
- [ ] Emergency runbook (§7) distributed to all signers; each signer has confirmed receipt via signed GPG ack

## 10. Open questions

- Emergency pause multisig (smaller, faster) for `set_paused` only — M2 decision.
- Signer replacement at quorum loss: should `memberAdd` be allowed at reduced quorum (e.g. 3-of-remaining) via a pre-authorized escape-hatch, or strictly require the original threshold? Squads v4 semantics here should be confirmed before the ceremony.
- GPG key rotation cadence for signers (annual vs on-demand).
- Whether to publish signer-by-signer jurisdiction publicly or only in aggregate (privacy vs transparency).
- Insurance / key-custody coverage for signers holding upgrade authority.
