# ZK-ML: Verifiable AI Inference for SAEP

**Status:** RESEARCH

## Problem

Agents claim to run specific models. How do we verify without re-executing?

In the SAEP protocol, agents register capabilities and accept tasks that may involve
ML inference — sentiment analysis, classification, embedding generation. Today, task
completion proofs attest that *a result was produced*, but not that *a specific model
produced it*. A malicious agent could substitute a cheaper model, return plausible
outputs, and collect rewards. Verifiable inference closes this gap.

## Approach

[EZKL](https://github.com/zkonduit/ezkl) converts ONNX-format neural networks into
ZK arithmetic circuits (Halo2-based, KZG commitments). Given a model, an input, and
an output, EZKL generates a succinct proof that the output is the correct result of
running the model on the input. The proof can be verified on-chain without access to
the model weights or the input data.

Key properties:

- **Model binding:** The proof is tied to a specific ONNX computation graph via a
  verification key derived from the circuit structure.
- **Input privacy (optional):** Inputs can be committed without revealing them.
  Useful for proprietary data or user-sensitive queries.
- **Deterministic verification:** A Solidity/SVM verifier checks the proof in
  constant time regardless of model complexity.

## Architecture

```
ONNX model
    |
    v
ezkl compile  ──>  circuit artifacts (proving key, verification key)
    |
    v
ezkl prove (off-chain)  ──>  proof.json
    |
    v
on-chain verification via proof_verifier program
    |
    v
task completion confirmed with ML-integrity attestation
```

### Flow

1. **Model registration:** Agent registers an ONNX model hash and the corresponding
   EZKL verification key on-chain (new PDA in `proof_verifier` or a dedicated
   `model_registry` program).
2. **Task execution:** Agent receives a task, runs inference locally, generates an
   EZKL proof alongside the output.
3. **Proof submission:** Agent submits the task result + EZKL proof to `proof_verifier`.
4. **Verification:** The on-chain verifier checks the proof against the registered
   verification key. If valid, the task completion is attested with an additional
   `ml_verified` flag.

## Integration Plan

Extend `proof_verifier` to accept EZKL proofs alongside existing Groth16
task-completion proofs:

- Add a `CircuitType::Ezkl` variant to the existing circuit type enum.
- Store EZKL verification keys in a new `VerifierKey` PDA layout (KZG parameters
  differ from the current bn254 Groth16 keys).
- The `verify_proof` instruction branches on circuit type and dispatches to the
  appropriate verifier logic.
- EZKL proofs carry a KZG commitment scheme; verification requires pairing checks
  on BN254 (same curve, different protocol). Investigate whether Solana's
  `alt_bn128` syscalls cover the operations EZKL needs.

See [`specs/zkml-integration.md`](../../specs/zkml-integration.md) for the detailed
integration spec.

## Use Cases

| Use Case | Model Type | Proof Verifies |
|---|---|---|
| Sentiment analysis | Small classifier (e.g., DistilBERT head) | Output label matches model prediction for given text embedding |
| Classification tasks | MLP / small CNN | Predicted class is correct for input features |
| Embedding similarity | Embedding model + cosine sim layer | Similarity score is faithfully computed |
| Content moderation | Binary classifier | Moderation decision is model-derived, not fabricated |

## Challenges

- **Proof size:** EZKL proofs for non-trivial models can be 10-100 KB. Solana
  transaction size limits (1232 bytes) require chunked submission or off-chain proof
  storage with on-chain commitment verification.
- **Verification cost (CU):** KZG pairing checks are expensive. Initial estimates
  suggest 200k-400k CU per verification. Needs benchmarking against Solana's 1.4M CU
  transaction limit — may require `requestHeapFrame` and `setComputeUnitLimit`.
- **Model size limits:** EZKL circuit compilation scales with model parameters.
  Models above ~10M parameters may produce circuits too large for practical proving
  times. Research which model architectures are EZKL-friendly.
- **Verifier availability:** EZKL's on-chain verifier targets EVM (Solidity). A
  native SVM verifier does not exist yet — this is the primary research blocker.
  Options: (a) port the Solidity verifier to BPF, (b) use Neon EVM compatibility
  layer, (c) contribute upstream to EZKL.

## Timeline

Prototype after M1 audit. Production integration at M2.

- **M1 (post-audit):** Proof-of-concept — compile a small ONNX model with EZKL,
  generate proofs off-chain, verify in a local test validator using a hand-ported
  verifier stub.
- **M2:** Production verifier program, model registry, integration with task-market
  proof flow.

## References

- [EZKL documentation](https://docs.ezkl.xyz/)
- [EZKL GitHub](https://github.com/zkonduit/ezkl)
- [Modulus Labs](https://www.modulus.xyz/) — ZK-ML proving system (alternative approach)
- [Giza](https://www.gizatech.xyz/) — Verifiable ML inference on StarkNet
- [Daniel Kang et al., "Scaling up Trustless DNN Inference with Zero-Knowledge Proofs"](https://arxiv.org/abs/2210.08674)
- Solana `alt_bn128` syscalls: [SIMD-0129](https://github.com/solana-foundation/solana-improvement-documents/pull/129)
