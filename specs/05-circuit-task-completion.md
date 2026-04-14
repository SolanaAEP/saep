# Spec 05 — Task Completion Circuit (Circom 2.0)

**Owner:** zk-circuit-engineer
**Depends on:** 01
**Blocks:** 06, 09
**References:** backend PDF §2.4 (Proof of Completion — Groth16 Integration), §5.1 (Proof-system-adjacent audit lines), §5.2 (Trusted-setup MPC with ≥20 participants), §6.1 (batch verification roadmap — out of M1 scope beyond the hook)

## Goal

A Circom 2.0 circuit + trusted-setup plan that lets an agent prove, in zero-knowledge, that: (1) it possesses a result matching the task's committed `task_hash`, (2) the result satisfies the declared success criteria, (3) the result was produced within the task deadline. On-chain verification lives in spec 06 via Light Protocol bn254 pairings.

M1 ships: one circuit file, its compiled wasm + r1cs, snarkjs test proofs, documented constraint count, and a written trusted-setup ceremony plan (execution is a separate calendar event before any real value is escrowed).

## Public inputs (verified on-chain)

Ordering is load-bearing — spec 06 hard-codes the same order.

1. `task_hash` — Poseidon2(salt, task_description) — 1 field element
2. `result_hash` — Poseidon2(result_preimage) — 1 field element
3. `deadline` — unix seconds, packed as field element — 1 field element
4. `submitted_at` — unix seconds — 1 field element
5. `criteria_root` — Merkle root of declared success-criteria predicates — 1 field element

Total public inputs: **5 field elements** (bn254 scalar field).

## Private inputs (witness)

- `result_preimage: Array<field, N_RESULT>` — chunked result content, N_RESULT = 32 field elements (M1 default; covers up to ~1 KB results; reviewer may tighten)
- `task_preimage: Array<field, N_TASK>` — N_TASK = 16 field elements
- `salt: field`
- `criteria_satisfied: Array<bit, K>` — K = 8 criteria bits (M1 default)
- `criteria_path: Array<field, log2(K)>` — Merkle path for `criteria_root`
- `criteria_index: Array<bit, log2(K)>`

## Constraints (what the circuit enforces)

1. `Poseidon2(salt, task_preimage) == task_hash`
2. `Poseidon2(result_preimage) == result_hash`
3. `MerkleVerify(criteria_satisfied, criteria_path, criteria_index) == criteria_root`
4. `AND(criteria_satisfied[0..K]) == 1` — every declared criterion is true
5. `submitted_at <= deadline` — range check via bit decomposition (32-bit bound on unix seconds fits comfortably; enforce `deadline - submitted_at >= 0` via a non-negative range proof on a 64-bit field)

Hash choice: **Poseidon2** over bn254. Rationale: bn254-native, ~200 constraints per hash vs ~24k for keccak. Note: on-chain `task_hash` computed by TaskMarket is also Poseidon2 — documented in spec 07. If the reviewer prefers keccak for EVM portability, circuit constraint budget must expand (see below).

## Constraint budget (M1 default, reviewer may tighten)

| Component | Constraints |
|---|---|
| Poseidon2(task_preimage) | ~3_200 |
| Poseidon2(result_preimage) | ~6_400 |
| Merkle verify depth-3 over K=8 | ~600 |
| AND of 8 bits + range checks | ~100 |
| `submitted_at <= deadline` (64-bit range) | ~130 |
| Plumbing | ~500 |
| **Target total** | **~11_000 constraints** |

Hard ceiling for M1: **20_000 constraints**. snarkjs proving time target: < 2s on a 16-core x86 worker; GPU target < 500ms. Verification cost on-chain (spec 06): ~400k CUs single proof, per §2.4.

## Deliverables

```
circuits/
├── task_completion/
│   ├── task_completion.circom        # top-level
│   ├── components/
│   │   ├── poseidon2.circom          # vendored or via circomlib
│   │   └── merkle_verifier.circom
│   ├── inputs/
│   │   └── sample_input.json
│   ├── scripts/
│   │   ├── compile.sh                # circom --r1cs --wasm --sym
│   │   ├── setup.sh                  # ptau fetch + groth16 setup (test srs)
│   │   ├── prove.sh
│   │   └── verify.sh
│   ├── build/                        # gitignored
│   └── README.md
```

The test trusted setup uses `powersOfTau28_hez_final_15.ptau` (Hermez-contributed, sized for ~32k constraints). **The test SRS is for local/dev only** — clearly labelled in README; mainnet proofs must use the MPC ceremony output below.

## Trusted-setup plan (MPC ceremony)

Per §5.2: **≥ 20 participants**, including independent cryptographers. Ceremony artifacts published publicly.

1. **Phase 1** — use existing publicly-audited Powers of Tau (Hermez `powersOfTau28_hez_final`). No custom Phase 1; piggybacks on Semaphore/Tornado lineage.
2. **Phase 2** — circuit-specific, run by SAEP. Plan:
   - Tool: `snarkjs groth16 contribute` in sequence; each contributor runs a clean room (air-gapped VM, webcam-recorded random beacon source).
   - Participant target: 25 (buffer over 20) — mix of SAEP team (≤ 5), invited cryptographers (≥ 10), independent community (≥ 10). Names and affiliations published before ceremony.
   - Randomness beacon: published block hash from a bitcoin block selected post-last-contribution (prevents any contributor from knowing the beacon in advance).
   - Transcript: each contribution's hash chained, all `*.zkey` artifacts + attestation signatures archived on Arweave (permanent).
   - Verification: `snarkjs zkey verify` run independently by ≥ 3 parties on the final zkey.
   - **Kill-switch:** if any participant leaks randomness, ceremony is re-run from scratch. There is no partial-trust fallback.
3. **Gate:** no mainnet escrow references a proof until the MPC ceremony zkey is published and the verifying key is loaded into the on-chain `VerifierKey` PDA via governance.

M1 devnet can proceed against the test SRS — explicitly labelled "devnet only" in `reports/05-circuit.md` and in the portal UI.

## Circuit file outline (no implementation, just shape)

```
pragma circom 2.1.5;
include "components/poseidon2.circom";
include "components/merkle_verifier.circom";

template TaskCompletion(N_TASK, N_RESULT, K) {
    signal input task_hash;
    signal input result_hash;
    signal input deadline;
    signal input submitted_at;
    signal input criteria_root;

    signal private input task_preimage[N_TASK];
    signal private input result_preimage[N_RESULT];
    signal private input salt;
    signal private input criteria_satisfied[K];
    signal private input criteria_path[log2(K)];
    signal private input criteria_index[log2(K)];

    // 1. task_hash binding
    // 2. result_hash binding
    // 3. merkle verify
    // 4. AND of criteria
    // 5. submitted_at <= deadline (64-bit range)
}

component main { public [task_hash, result_hash, deadline, submitted_at, criteria_root] } =
    TaskCompletion(16, 32, 8);
```

## Test plan

- **snarkjs end-to-end:** generate witness from `sample_input.json`, prove, verify off-chain. CI step under `.github/workflows/ci.yml`.
- **Negative tests:**
  - Tampered `result_preimage` → `result_hash` mismatch → proving fails
  - `submitted_at > deadline` → range check fails
  - Missing criterion bit → AND check fails
  - Wrong Merkle path → verify fails
- **Constraint count** printed to stdout during `compile.sh`; committed as a snapshot in `reports/05-circuit.md`. CI asserts count < 20_000.
- **Proving time** measured on CI runner and on a reference GPU worker; baseline written to report.
- **Determinism:** same input → same proof bytes (given same srs + same randomness). Non-determinism flagged.

## Events (off-chain, proof-gen service contract)

The circuit itself emits nothing. Proof-gen (spec 09) publishes `ProofGenerated { task_id, proof_bytes, public_inputs }` into IACP. ProofVerifier (spec 06) consumes the proof + public inputs on-chain.

## Errors (circuit compile/prove layer)

- `InvalidWitness` — witness generation fails (preimage mismatch)
- `ConstraintViolation` — any of the 5 enforced constraints false
- `RangeCheckFailed` — `submitted_at > deadline` or values exceed 64-bit field
- `MerkleProofInvalid`

## Invariants

1. Any valid proof implies `Poseidon2(result_preimage) == result_hash`; on-chain `result_hash` can be trusted as binding to real content.
2. Valid proof ⇒ `submitted_at <= deadline`; no post-deadline submission can be verified.
3. Changing the circuit requires a new verifying key + governance rotation (spec 06). Old proofs do not verify against a new VK.
4. Public-input ordering in the circuit matches spec 06 exactly.

## Security checks (backend §5.1 / §5.2 adjacent)

- **Proof system trusted setup:** ceremony plan above meets §5.2 (≥ 20 participants, transcript published, independent cryptographers).
- **No partial trust:** test SRS never used on mainnet. Clearly gated via program state (`VerifierKey.is_production` flag, see spec 06).
- **Input encoding:** unix timestamps bounded to 64 bits pre-range-check to prevent field wraparound.
- **Hash domain separation:** Poseidon2 invocations use distinct parameter sets / salts for `task_hash` vs `result_hash` (reviewer confirms via circomlib version pin).
- **Side channels:** proof-gen service (spec 09) runs on dedicated workers; no shared-memory with untrusted workloads.

## Open questions for reviewer / cryptographer review

- Poseidon2 vs Poseidon vs keccak: current pick Poseidon2 for constraint efficiency; confirm circomlib binding version and audit status.
- `N_RESULT = 32`, `K = 8` — upper bounds guessed; real task results may exceed 1 KB. If so, either chunk and batch-prove (M2), or raise `N_RESULT` with linear constraint growth.
- Whether `criteria_root` should itself be bound on-chain (spec 07 open question).

## Done-checklist

- [ ] `task_completion.circom` compiles with circom 2.1+
- [ ] `compile.sh` emits r1cs, wasm, sym; constraint count logged and < 20_000
- [ ] Test SRS generated and `snarkjs groth16 fullprove` succeeds on `sample_input.json`
- [ ] Verifying key exported to `build/verification_key.json` (consumed by spec 06 fixtures)
- [ ] All negative tests pass (witness rejection expected)
- [ ] Proving time benchmark on CI and GPU reference recorded
- [ ] `reports/05-circuit-zk.md` contains: constraint breakdown, proving-time table, ceremony participant target list (placeholders), test-SRS warning
- [ ] MPC ceremony plan reviewed by ≥ 1 external cryptographer (sign-off captured)
- [ ] No mainnet artifact produced from test SRS (CI guard)
