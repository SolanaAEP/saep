# Circuit: task_completion — WIP integration note

Scope: scaffold-only commit. Real compilation + dev-only trusted setup happens on a host
with `circom` installed; numbers below refine then.

## Constraint count

- **Observed:** not measured — `circom` binary not present on this worker. `compile.sh`
  pipes `snarkjs r1cs info` into `build/constraints.txt` so the first real CI run lands
  the canonical number.
- **Estimated:** ~2 500 constraints using circomlib Poseidon (original, not Poseidon2).
  Well under the 15 000 target and the 20 000 hard ceiling from spec 05.
- Estimate breakdown is in `circuits/README.md`.

If the ceremony pins Poseidon2 (see `// POSEIDON-PARAMS-STUB`), expect ±10 % drift; still
comfortably under budget.

## Public vs private signals

Public (on-chain verifier consumes in this exact order — spec 06 hard-codes it):

1. `task_hash` — Poseidon(salt, task_preimage)
2. `result_hash` — Poseidon(result_preimage)
3. `deadline` — unix seconds, 64-bit bounded
4. `submitted_at` — unix seconds, 64-bit bounded
5. `criteria_root` — Merkle root over declared criteria bits

Private (witness only):

- `task_preimage[16]`, `result_preimage[32]`, `salt`
- `criteria_satisfied[8]`, `criteria_path[3]`, `criteria_index[3]`

Spec-06 ordering invariant is enforced by the `component main { public [...] }` directive
at the bottom of `task_completion.circom`. Any reorder there breaks on-chain verification.

## VK flow into proof_verifier

1. `circuits/task_completion/scripts/setup.sh` emits `build/verification_key.json` plus a
   sibling `verification_key.meta.json` with `is_production: false`. Both are committed.
2. spec-06 `proof_verifier` exposes `init_verifier_key` and `rotate_verifier_key`
   instructions (already scaffolded) that load the VK into a `VerifierKey` PDA.
3. On-chain glue is **stubbed** — marked `// VK-WIRE-STUB` in the circuit README. The
   Anchor side is expected to parse the JSON off-chain, convert to bn254 affine limbs, and
   push via a governance-gated ix. Neither the encoder nor the ix wiring is in this
   commit.
4. Production VK comes only from the MPC ceremony (≥ 20 contributors, Arweave transcript).
   `VerifierKey.is_production` gates mainnet use; dev VK never sets it.

## Stubbed vs done

Done:
- Circom 2.1.5 circuit with Poseidon absorb sponge, fixed-depth Merkle verifier,
  AND-of-bits, 64-bit range-bounded `submitted_at <= deadline`.
- Domain-separated Poseidon invocations (distinct tags for task vs result hash).
- `package.json` with pinned `circomlib@2.0.5` + `snarkjs@0.7.4`.
- `compile.sh`, `setup.sh`, `prove.sh`, `verify.sh` — executable, idempotent.
- `.gitignore` for `.ptau`, `.zkey`, wasm, r1cs, proofs; VK JSON + meta committed.
- README documenting dev-only status, constraint estimate, known limitations.

Stubbed / deferred:
- `// TRUSTED-SETUP-DEV-ONLY` — `setup.sh` runs a single-contributor ceremony; the real
  ≥ 20-participant MPC is a scheduled calendar event, not code.
- `// POSEIDON-PARAMS-STUB` — circomlib Poseidon stands in for Poseidon2 until the
  variant is pinned by the cryptographer reviewer.
- `// VK-WIRE-STUB` — no on-chain loader; `proof_verifier` still reads a hardcoded VK in
  tests. End-to-end VK push through governance lands with spec 06 completion.
- `build/verification_key.json` is a **schema placeholder** (empty arrays) until the
  first real compile + `setup.sh` run overwrites it. `build/verification_key.meta.json`
  flags this with `status: "dev-only-placeholder"`.
- `inputs/sample_input.json` is zeroed — a real witness generator (JS-side Poseidon) ships
  with proof-gen service (spec 09).
- No negative-test harness, no proving-time benchmark, no CI job yet — all called out in
  the done-checklist of spec 05 and tracked against later commits.

## Blockers

- Need `circom` binary on the build worker (or a CI runner with it installed) to land
  real constraint count and VK bytes. Cargo install from the iden3 repo takes ~3 min on
  a clean host — fine for CI, not for this scaffold wall clock.
- Cryptographer reviewer sign-off on Poseidon vs Poseidon2 choice before the MPC
  ceremony; this is spec-05's open-question §1.
