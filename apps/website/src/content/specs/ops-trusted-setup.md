# Spec — Trusted-Setup Ceremony (Ops)

**Owner:** zk-circuit-engineer + lead maintainer
**Depends on:** 05 (circuit frozen, `task_completion.r1cs` final), 06 (`proof_verifier::rotate_vk` instruction deployed), multisig provisioning (see `ops-squads-multisig.md`)
**Blocks:** any mainnet escrow referencing a Groth16 proof
**References:** [GOVERNANCE.md](../GOVERNANCE.md) §Trusted setup, backend PDF §5.2 (MPC with ≥20 participants), spec 05 §Trusted-setup plan

> **This spec is for execution AFTER the circuit is frozen and audited, and AFTER the governance multisig is live.** The ceremony output — `task_completion_final.zkey` and the extracted `verification_key.json` — is the binding commitment that lets on-chain proofs be trusted. A mistake here is not patchable by a code fix.

## Goal

Run the Groth16 Phase 2 ceremony for the task-completion circuit, producing a verifying key (VK) that SAEP is willing to enshrine on-chain via `proof_verifier::rotate_vk`. The ceremony must make it so that **any single honest participant is sufficient to guarantee the final VK's soundness** (linear-combination property of Groth16 Phase 2).

## 1. Participant count — why ≥ 20

Groth16 Phase 2 has the "one honest participant is enough" property: the final toxic waste is the product of every contributor's secret, and knowing the final secret requires knowing **every** contributor's secret. So more contributors = more robust, with sharp diminishing returns after ~10.

SAEP targets **≥ 25 contributors** (buffer of 5 over the §5.2 minimum of 20) because:

- Some contributors will drop out during a multi-week ceremony — a 25-contributor slate typically lands ~20 verified contributions.
- Larger slate makes the "all contributors colluded" scenario more obviously implausible.
- Historical precedent: Zcash Sapling had 90, Tornado Cash had 1,114, Semaphore's trusted setup used the perpetual Powers of Tau. 25 is modest by these standards but adequate for a protocol-local Phase 2.

### Who counts as "independent"

A contributor counts toward the 20-minimum only if:

- **No organizational overlap:** no two contributors work for or substantially advise the same company, VC, or DAO. "Substantially advise" = receive compensation, equity, or tokens.
- **Verifiable identity:** contributor's real name or long-established pseudonymous identity is public; a GitHub/Twitter/academic profile with ≥ 2 years of activity is required. Anonymous contributions are accepted as additional but do not count toward the minimum.
- **Public attestation:** contributor signs a public statement (GPG or Solana-wallet-signed) attesting to their contribution hash and describing their randomness-destruction procedure.
- **Independent randomness source:** each contributor describes in their attestation what hardware entropy they used (hardware RNG, dice rolls, atmospheric noise, etc). A contributor using only `/dev/urandom` on a VPS is not disqualified but is flagged in the transcript.
- **No SAEP team majority:** at most 5 of the 20 minimum can be SAEP core team. The remainder must be external: ≥ 10 invited cryptographers / protocol engineers, ≥ 5 broader community.

The specific participant slate is **deferred to governance** — see §10.

## 2. Phase 1 — Powers of Tau (no custom ceremony)

SAEP does **not** run its own Phase 1. Running a Phase 1 only for SAEP would take weeks of coordination with no security benefit over reusing a long-running public ceremony.

**Use:** the perpetual Powers of Tau maintained by the community (originally Hermez, continued by 0xPARC and others). Canonical mirrors:

- Snarkjs project tau ceremony list: https://github.com/iden3/snarkjs#7-prepare-phase-2
- Perpetual Powers of Tau repository: https://github.com/privacy-scaling-explorations/perpetualpowersoftau

**Pinned file:** `powersOfTau28_hez_final_15.ptau` (supports up to 2^15 ≈ 32k constraints; spec 05 caps the circuit at 20k).

- **Source URL:** https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_15.ptau
- **BLAKE2b hash (pin this at ceremony time; the value below is a placeholder to be replaced with a verified hash at time of use):** `<BLAKE2B_HASH_TBD_PINNED_AT_CEREMONY>`
- **Verify before use:**

```bash
snarkjs powersoftau verify powersOfTau28_hez_final_15.ptau
```

This check must pass on ≥ 3 independent machines run by ≥ 3 different contributors before Phase 2 begins. Any mismatch aborts the ceremony.

The pinned hash and verification attestations go into `circuits/ceremony/phase1/README.md` along with download URL, verification date, and verifier signatures.

## 3. Phase 2 — circuit-specific

Phase 2 is linear: each contributor receives `zkey_{i}`, mixes in their randomness, produces `zkey_{i+1}`, and passes it forward. Concretely, using snarkjs:

```bash
# contributor i: receives previous.zkey, outputs contribution.zkey
snarkjs zkey contribute previous.zkey contribution.zkey \
  --name="contributor-<handle>" \
  -v \
  -e="$(head -c 64 /dev/urandom | base64)"  # actual entropy per §5
```

### 3.1 Initial zkey

Maintainers produce the starting zkey from the circuit's r1cs and the pinned Phase 1 output:

```bash
snarkjs groth16 setup \
  task_completion.r1cs \
  powersOfTau28_hez_final_15.ptau \
  task_completion_0000.zkey
```

This `_0000.zkey` is published along with its hash; every contributor verifies the starting point independently:

```bash
snarkjs zkey verify task_completion.r1cs powersOfTau28_hez_final_15.ptau task_completion_0000.zkey
```

### 3.2 Contribution handoff

- Contributions are numbered `task_completion_0001.zkey`, `task_completion_0002.zkey`, etc.
- Each file is ~200 MB for a ~11k-constraint circuit (spec 05 target).
- Transport: contributor uploads to Arweave (preferred, permanent) or IPFS; URL and hash are posted in the public transcript.
- The next contributor downloads, verifies, contributes, uploads. Coordinator (see §9) maintains the ordering queue and publishes the "next up" pointer.

### 3.3 Final beacon

After the last contribution, a public randomness beacon is applied to remove any last-contributor adaptive-choice advantage:

```bash
# beacon = hex of a future, unpredictable value — see below
snarkjs zkey beacon task_completion_<last>.zkey task_completion_final.zkey \
  <BEACON_HEX> 10 \
  -n="Final Beacon"
```

**Beacon source:** the block hash of a specific Bitcoin block chosen by the coordinator **after** the last contribution has been received. The block height is chosen to be ≥ 6 blocks in the future at the moment of announcement (~1 hour in Bitcoin), making grinding infeasible. The chosen block height and the resulting hash are published in the transcript.

### 3.4 Verify final zkey

```bash
snarkjs zkey verify \
  task_completion.r1cs \
  powersOfTau28_hez_final_15.ptau \
  task_completion_final.zkey
```

Run independently by ≥ 3 parties, none of whom were among the contributors. Each produces a signed attestation.

### 3.5 Extract verifying key

```bash
snarkjs zkey export verificationkey \
  task_completion_final.zkey \
  verification_key.json
```

## 4. Participant vetting

### 4.1 Application + disclosure

Prospective contributors submit:

- Real name or long-standing pseudonym.
- Professional / academic affiliation. Disclosure of any affiliation with current SAEP contributors, investors, or prior ceremony participants.
- Planned contribution environment (see §5).
- GPG fingerprint for signing their attestation.
- Optional: Solana pubkey for an on-chain attestation transaction.

### 4.2 Maintainer review

Maintainers check:

- No organizational overlap (§1).
- Application metadata is consistent with publicly-verifiable sources.
- Contribution environment meets §5 minimums.

Accepted applications are posted publicly for a 7-day comment window before the slate is frozen. Community members can flag conflicts during this window.

### 4.3 Governance sign-off

Per GOVERNANCE.md, the final participant list is proposed by maintainers and confirmed by a governance vote. For M1 (pre-`governance_program`), the governance multisig (see `ops-squads-multisig.md`) signs a transaction endorsing the slate; the endorsement tx hash is recorded in the ceremony transcript.

## 5. Toxic-waste protocol

Each contributor executes their contribution on an **air-gapped machine** with the following properties. Non-negotiable for the ≥ 20 who count toward the minimum.

### 5.1 Machine prep (day-of)

- Freshly flashed OS from verified media (Tails, or a minimal Debian from a known-hash ISO). Drive wiped before install.
- Network hardware physically removed or disabled in BIOS. Wi-Fi antenna physically disconnected if possible. Machine never touches a network from this point until it is destroyed at end of contribution.
- Intermediate files live on a **RAM-disk** (`tmpfs`), never written to persistent storage:

```bash
sudo mount -t tmpfs -o size=8G tmpfs /mnt/ramdisk
cd /mnt/ramdisk
# do all contribution work here
```

- Entropy: contributor mixes at least two sources. Examples: hardware RNG (YubiKey, Infineon, OneRNG); dice rolls (≥ 256 bits, hashed); keyboard-timing jitter captured by a user-space tool. The entropy source is described in the public attestation (not the value — the source).

### 5.2 Contribution

- Input zkey is delivered via USB stick flashed from the contributor's air-gapped machine, after they download it on a separate online machine and hash-verify it.
- `snarkjs zkey contribute` runs on the air-gapped machine.
- Output zkey is copied to a fresh USB stick.

### 5.3 Destruction

After `snarkjs zkey contribute` completes and the output is on the outgoing USB stick:

1. `sync` and unmount the tmpfs — RAM contents become unreferenced.
2. **Power-cycle the machine** (hard power-off, then wait ≥ 60 seconds for DRAM to fully decay; cold-boot attacks against DDR4 generally fail past ~30s at room temperature, 60s is safe margin).
3. **Wipe persistent storage** even though contribution never wrote there: `shred -vzn 3 /dev/<disk>` or ATA Secure Erase.
4. **Physical destruction** of the DRAM modules is not required but is strongly recommended for contributors with adversarial threat models.
5. **Video attestation:** the contributor records a continuous, unedited video showing:
   - Machine powered on, ceremony run (or its end).
   - Power-off / disconnect.
   - Visible wait period (clock or timer in frame).
   - Drive wipe command entered on a separate verification machine (or the shredding of removable storage).
   - Final sign-off: contributor states date, their name/handle, the contribution hash they produced.

The video is uploaded to a public host (YouTube, Arweave, IPFS) and linked from the transcript. Faces are not required; voice and verifiable hash announcement are.

### 5.4 USB sticks

Incoming USB stick: wiped or physically destroyed after use.
Outgoing USB stick: handed off to the coordinator or uploaded from a separate machine; the stick is then wiped.

## 6. Public contribution transcript

Each contributor publishes a signed transcript entry. Format (committed to `circuits/ceremony/phase2/contributions/<NNNN>-<handle>.md`):

```markdown
# Contribution NNNN — <handle>

## Identity
- Name / handle: <value>
- Affiliation: <value>
- GPG fingerprint: <value>

## Artifact
- Input zkey: task_completion_<NNNN-1>.zkey
  - Arweave / IPFS URL: <url>
  - BLAKE2b hash: <hash>
- Output zkey: task_completion_<NNNN>.zkey
  - Arweave / IPFS URL: <url>
  - BLAKE2b hash: <hash>
- Contribution hash (from `snarkjs zkey contribute -v` output): <hash>

## Environment
- Hardware: <model / serial-redacted>
- OS: <Tails version / Debian version>
- Entropy sources: <e.g. YubiKey HRNG + 512 dice rolls>

## Destruction
- Power-cycled at: <timestamp>
- Storage wiped: <method>
- Video URL: <url>
- Video BLAKE2b hash: <hash>

## Attestation
I, <name/handle>, attest that:
1. I executed the contribution on an air-gapped machine as described.
2. I destroyed all randomness used in the contribution.
3. I have no undisclosed affiliation with any other contributor.

Signed (GPG detached signature below):
<signature>
```

The hash chain `N-1.zkey → N.zkey → N+1.zkey` is auditable by anyone re-running `snarkjs zkey verify` against the r1cs and Phase 1 at each step.

## 7. Verification (by anyone)

After the ceremony closes, anyone can reproduce the verification:

```bash
# fetch the pinned Phase 1
wget https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_15.ptau
snarkjs powersoftau verify powersOfTau28_hez_final_15.ptau

# fetch the circuit r1cs (from the SAEP repo at the ceremony-freeze commit)
git checkout <ceremony_freeze_commit>
cd circuits/task_completion
bash scripts/compile.sh  # reproduces r1cs

# fetch the final zkey from Arweave (URL in circuits/ceremony/phase2/README.md)
wget <final_zkey_url>
snarkjs zkey verify task_completion.r1cs powersOfTau28_hez_final_15.ptau task_completion_final.zkey

# extract and compare the verification key
snarkjs zkey export verificationkey task_completion_final.zkey verification_key.json
diff verification_key.json circuits/ceremony/phase2/verification_key.json
```

All checks must be clean. Any mismatch invalidates the ceremony and the on-chain VK must be rotated back to a known-good state.

The transcript includes a `VERIFY.md` with this exact script, commit hashes pinned, and expected hashes for every artifact.

## 8. Failure modes

### 8.1 Contributor transcript doesn't verify

If `snarkjs zkey verify` fails on any `zkey_{i}`:

- That contribution is invalid. The ceremony does **not** abort.
- The chain is rewound to `zkey_{i-1}`. The contributor is asked to retry or is dropped from the slate.
- If dropped, their slot is either backfilled (if another vetted contributor is available and the timeline allows) or skipped (the ceremony proceeds with one fewer contributor, still ≥ 20).
- The failed attempt is recorded publicly — not hidden.

### 8.2 Contributor later revealed compromised

Compromise here means: contributor's randomness is confirmed leaked or they are later shown to have used a predictable/backdoored RNG.

**Groth16 Phase 2 is robust to this as long as at least one other contributor was honest and independent.** The final secret is a product; any honest factor suffices.

Action:

- Publish a security advisory stating the compromise.
- Re-verify independence of remaining contributors (audit their affiliations and entropy claims).
- If ≥ 1 contributor remains plausibly honest and independent: the VK stays in use. Transcript updated with the advisory.
- If no contributor remains plausibly honest: **the VK is compromised**. Governance proposes a new ceremony. During the gap, `proof_verifier` can be paused (via multisig) to prevent escrows from releasing against the compromised VK. New VK rotates in via `rotate_vk` when the re-ceremony completes.

Re-running the ceremony takes weeks; the operational response is to pause affected programs and communicate, not to rush.

### 8.3 Phase 1 ptau file found to be compromised

Extremely unlikely given the perpetual ceremony's 100+ contributors, but theoretically possible if every single contributor colluded.

Response: switch to a different Phase 1 mirror (there are ceremonies from Hermez, Semaphore, 0xPARC, etc. that are independent cohorts). Re-run Phase 2 from scratch. Rotate VK.

### 8.4 Coordinator misbehavior

Coordinator (§9) could in principle skip a contribution, reorder, or substitute a zkey. Mitigations:

- Every `zkey_{i}` is publicly posted with its hash before the next contributor pulls it. Reordering or skipping is detectable by comparing hashes across multiple observers.
- Contributors verify the zkey they received against the previous contributor's published output hash before contributing.
- At least 3 independent observers maintain mirror transcripts and flag discrepancies.

## 9. Coordinator role

A **ceremony coordinator** (single human, maintainer-appointed) handles operational flow: queue management, artifact hosting, contributor scheduling, transcript publication.

The coordinator has **no cryptographic privilege**. They cannot influence the output beyond the operational choices (ordering, beacon block selection). Contributors verify every input independently.

Backup coordinator is named before ceremony begins; takes over if primary is unreachable for > 48 hours.

## 10. Scheduling

Realistic timeline, async mode (default):

| Phase | Duration | Notes |
|---|---|---|
| Participant call-for-applications | 2 weeks | Public, with reminders |
| Maintainer vetting + public comment | 1 week | §4.1–4.2 |
| Governance slate endorsement | 3–5 days | Multisig signing |
| Phase 1 verification | 1 day | ≥ 3 independent verifications |
| Phase 2 initial zkey + publication | 1 day | Maintainer-produced |
| Phase 2 contributions | 3–5 weeks | Async; ~1 contributor/day with buffer for handoff delays and failures |
| Beacon + finalization | 1 day | §3.3 |
| Final verification | 1 week | Independent verifiers + community review |
| On-chain VK rotation proposal | governance multisig | §11 |
| Timelock + execution | per governance timelock | |

**Total: ~8–10 weeks** from call to on-chain VK live.

Synchronous mode (all contributors in one room over 2–3 days) is faster but logistically harder; not planned for M1.

## 11. Output + on-chain activation

Deliverables committed to `circuits/ceremony/phase2/`:

```
circuits/ceremony/
├── phase1/
│   ├── README.md                    # source URL, hash, verifiers
│   └── VERIFY.md                    # reproduction script
├── phase2/
│   ├── README.md                    # ceremony overview, participant list, timeline
│   ├── task_completion_0000.zkey    # starting zkey (or URL pointer if too large)
│   ├── task_completion_final.zkey   # final zkey (URL pointer)
│   ├── verification_key.json        # extracted VK
│   ├── VERIFY.md                    # reproduction script (§7)
│   ├── BEACON.md                    # beacon block, hash, rationale
│   └── contributions/
│       ├── 0001-<handle>.md
│       ├── 0002-<handle>.md
│       └── ...
```

On-chain rotation:

1. Maintainers prepare a `rotate_vk` transaction for `proof_verifier` with the new VK serialized per spec 06's format.
2. Governance multisig (6-of-9) signs per `ops-squads-multisig.md`.
3. Governance-program timelock (M2) or multisig timelock (M1) runs its course; community has the window to independently verify the VK matches the ceremony output.
4. Execute. `proof_verifier::VerifierKey.is_production = true`.
5. Ceremony transcript linked from `reports/trusted-setup.md` and from SECURITY.md.

Before this point, `is_production = false` and only test-SRS proofs are accepted, which production escrows refuse (spec 05 §Security checks).

## 12. Done-checklist

- [ ] Circuit frozen at ceremony commit; r1cs hash pinned
- [ ] Phase 1 ptau downloaded, verified by ≥ 3 independent parties, hash pinned
- [ ] Participant slate: ≥ 20 qualifying contributors, no organizational overlap, governance-endorsed
- [ ] Coordinator + backup coordinator named; contact info distributed
- [ ] `task_completion_0000.zkey` produced and published with hash
- [ ] Every contribution has: attestation markdown, GPG signature, video URL, zkey URL+hash
- [ ] Beacon applied; block height and hash published
- [ ] `snarkjs zkey verify` clean on final zkey, run independently by ≥ 3 non-contributors
- [ ] `verification_key.json` extracted; committed to `circuits/ceremony/phase2/`
- [ ] Reproduction script (`VERIFY.md`) tested end-to-end on a fresh machine
- [ ] Governance multisig endorsement of ceremony-complete status recorded
- [ ] `proof_verifier::rotate_vk` proposed, timelock passed, executed
- [ ] `VerifierKey.is_production = true` verified on-chain
- [ ] Old test-SRS VK retired; programs refuse test-SRS proofs on mainnet
- [ ] `reports/trusted-setup.md` written: participant list, timeline, deviations, any failure-mode invocations

## 13. Open questions (deferred to governance)

- **Final participant list.** Maintainers propose; governance votes. Do not put candidate names in this spec or in any pre-ceremony document beyond the public application list.
- **Backup coordinator identity.** Same vetting as contributors; governance may request veto rights.
- **Whether to require in-person attendance for a subset of contributors** (e.g. ≥ 3 maintainers at a single physical location for the opening ceremony). Adds logistical cost; buys narrative strength.
- **Video hosting choice.** YouTube (easy, non-permanent), Arweave (permanent, larger upload), or both. Transcript format supports both; pick per-contributor.
- **Post-ceremony audit.** Whether to commission an independent cryptographer to audit the ceremony output and publish a short report. Recommended but not required. Cost ~$15–25k.
- **Whether the ceremony is repeated on a schedule** (e.g. annually) as cryptographic hygiene, or only when the circuit changes. Default: only when the circuit changes, since Groth16 VKs are circuit-specific.
