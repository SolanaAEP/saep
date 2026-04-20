# ZK-ML Integration Spec

**Status:** DRAFT — depends on research in [`circuits/zkml/README.md`](../circuits/zkml/README.md)

## Scope

Extend the `proof_verifier` program to support EZKL-generated verifiable-inference
proofs alongside the existing Groth16 task-completion proofs.

## Changes Needed

### 1. New `VerificationKeyType::Ezkl` variant

The `proof_verifier` program currently supports Groth16 BN254 verification keys.
Add a new variant to the verification key type enum:

```rust
pub enum VerificationKeyType {
    Groth16Bn254,
    Ezkl,  // KZG-based, Halo2 circuit
}
```

### 2. Extended `VerifierKey` PDA layout

EZKL verification keys use KZG polynomial commitments rather than Groth16 pairings.
The on-chain key representation differs:

- **Groth16:** alpha, beta, gamma, delta G1/G2 points + IC array
- **EZKL/KZG:** commitment scheme parameters, circuit-specific verification data

Add a `circuit_type` field to the `VerifierKey` PDA so the `verify_proof` instruction
can dispatch to the correct verification path:

```rust
pub struct VerifierKey {
    pub authority: Pubkey,
    pub circuit_type: VerificationKeyType,
    pub key_data: Vec<u8>,  // serialized verification key (format depends on circuit_type)
    pub model_hash: [u8; 32],  // EZKL only: SHA-256 of the ONNX model
    pub bump: u8,
}
```

### 3. EZKL verifier logic

The `verify_proof` instruction branches on `circuit_type`:

- `Groth16Bn254` — existing path (Groth16 pairing check via `alt_bn128` syscalls)
- `Ezkl` — new path: KZG commitment verification

The EZKL verifier needs:
- Multi-scalar multiplication on BN254 G1
- Pairing check (BN254)
- Polynomial evaluation check

Solana's `alt_bn128_g1_compress`, `alt_bn128_g1_decompress`,
`alt_bn128_addition`, `alt_bn128_multiplication`, and `alt_bn128_pairing`
syscalls may cover these operations, but this requires verification against
EZKL's specific proof structure.

### 4. Proof submission format

EZKL proofs are larger than Groth16 proofs. Submission options:

- **Chunked upload:** Split proof across multiple transactions, reconstruct in a
  buffer PDA, verify once complete.
- **Off-chain proof + on-chain commitment:** Store proof on Arweave/Shadow Drive,
  submit hash on-chain, verify via a cranked verification transaction with the full
  proof loaded via remaining accounts / lookup tables.

## Open Questions

1. **KZG vs Groth16 backend selection in EZKL:** EZKL supports multiple backends.
   KZG (Halo2) is the default and most mature. Groth16 export is experimental. If
   EZKL's Groth16 export stabilizes, we could reuse the existing Groth16 verifier
   path — significantly reducing implementation scope.

2. **CU budget for EZKL verification:** Pairing checks on BN254 cost ~110k CU each
   on Solana. EZKL verification requires multiple pairings. Need to benchmark whether
   total CU fits within a single transaction (1.4M CU limit) or requires a
   verification pipeline spread across multiple transactions.

3. **Model registry — which models are approved for which task types:** Not every
   ONNX model should be accepted. The protocol needs a governance-controlled registry
   mapping task types to approved model hashes and their corresponding verification
   keys. This could live in `proof_verifier` or in a separate `model_registry`
   program.

4. **Proof freshness:** How do we prevent replay of old proofs? Tie proofs to task
   IDs or include a nonce/timestamp in the public inputs.

5. **Prover performance:** EZKL proving time for a small MLP (~1k parameters) is
   ~2-5 seconds. For larger models, proving can take minutes. This affects agent UX
   and task completion latency. Need to define acceptable latency bounds per task type.

## Dependencies

- **EZKL Solana verifier:** Does not exist yet. This is the primary research item.
  The EZKL team provides a Solidity verifier contract. Porting to BPF/SBF or finding
  an alternative execution path (Neon EVM, custom precompile) is required.
- **Solana `alt_bn128` syscalls:** Available on mainnet since v1.16. Need to confirm
  all required operations are supported and benchmark CU costs.
- **`proof_verifier` v2 account layout:** The current program may need a major
  version bump to accommodate the new PDA structure. Coordinate with M1 audit scope.
