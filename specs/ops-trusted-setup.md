# Spec — Trusted Setup Public Policy

**Owner:** zk-circuit-engineer
**Depends on:** 05 (circuit frozen, `task_completion.r1cs` final), 06 (`proof_verifier` verification-key load path available)
**Blocks:** any production escrow that depends on Groth16 proof verification
**References:** [GOVERNANCE.md](../GOVERNANCE.md) §Trusted setup, backend PDF §5.2, spec 05 §Trusted-setup plan

> This document defines the public acceptance criteria for any production Groth16 ceremony used by SAEP. Contributor coordination, signer handling, device procedures, and maintainer-only checklists are intentionally excluded from this repository.

## Goal

Produce a Groth16 proving key and verifying key that SAEP can trust on-chain, with enough public evidence for independent parties to verify the ceremony inputs, outputs, and final binding to `proof_verifier`.

## Public commitments

1. **Public Phase 1 artifact.** SAEP reuses a public Powers of Tau artifact. The exact filename, source URL, and content hash must be pinned before Phase 2 begins.
2. **Independent Phase 2 contributions.** Production ceremonies require at least 20 independent contributions. SAEP may target a larger set, but the public acceptance floor is 20.
3. **Reproducible final artifact set.** The final proving key, verifying key, and transcript manifest must be published with stable hashes so anyone can reproduce the verification steps.
4. **No production use before verification.** No production proof is accepted until the final verifying key is loaded on-chain and matched against the published artifact hash.

## Required public artifacts

The public record for a production ceremony must include:

- The pinned Phase 1 artifact filename, origin, and cryptographic hash.
- The circuit hash or exact circuit commit used for Phase 2.
- The final `*.zkey` hash.
- The exported `verification_key.json` hash.
- A transcript manifest with the ordered contribution hashes.
- Independent verification output from at least three verifiers running `snarkjs zkey verify` or an equivalent check.
- The on-chain transaction or proposal that loads the final verifying key into `proof_verifier`.

Contributor identifiers may be public if SAEP chooses to publish them, but personal contact details and private coordination records do not belong in this repo.

## Acceptance gates

A ceremony is production-acceptable only if all of the following are true:

- The pinned Phase 1 artifact hash matches the published value.
- The final `zkey` verifies successfully against the pinned Phase 1 artifact and the exact circuit output.
- The exported verifying key hash matches the hash referenced in the public record.
- The on-chain `proof_verifier` state references the same verifying key material that was published.
- Any devnet or test SRS is clearly marked non-production and is not referenced by production governance or release artifacts.

Any mismatch invalidates the ceremony output for production use. The correct response is to rerun the ceremony and publish a new artifact set, not to patch around the mismatch in documentation.

## Repository boundary

This repository may contain:

- Public requirements and thresholds.
- Public hashes, manifests, and verification outputs.
- Public governance references and on-chain verification records.

This repository must not contain:

- Private coordination notes.
- Contributor contact data.
- Maintainer-only scheduling material.
- Device-custody instructions or recovery procedures.
- Raw private ceremony media or other operational artifacts.

## Verification flow

The public verification flow is:

1. Fetch the pinned Phase 1 artifact and verify its hash.
2. Fetch the circuit output identified in the transcript.
3. Fetch the final `zkey` and verify it with `snarkjs zkey verify`.
4. Export or inspect the verifying key and compare its hash to the published value.
5. Compare that hash with the on-chain `proof_verifier` state and the governance or deployment transaction that activated it.

## Done checklist

- [ ] Phase 1 artifact URL, filename, and hash published
- [ ] Circuit commit or circuit hash published
- [ ] Final `zkey` hash published
- [ ] `verification_key.json` hash published
- [ ] Transcript manifest published with ordered contribution hashes
- [ ] Independent verification output from at least 3 verifiers published
- [ ] On-chain `proof_verifier` activation transaction published
- [ ] Public record confirms dev/test SRS artifacts are non-production only
