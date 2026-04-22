# Verify Phase 2

These commands let an independent verifier reproduce the final VK from the
frozen circuit, the pinned Phase 1 artifact, and the final Phase 2 zkey.

## 1. Check out the frozen commit and rebuild the circuit

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"
git checkout <CEREMONY_FREEZE_COMMIT>
cd circuits
pnpm install
cd task_completion
bash scripts/compile.sh
shasum -a 256 build/task_completion.r1cs
```

## 2. Verify the Phase 1 artifact

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT/circuits/ceremony/phase1"
shasum -a 256 powersOfTau28_hez_final_15.ptau
snarkjs powersoftau verify powersOfTau28_hez_final_15.ptau
```

## 3. Verify the final zkey

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT/circuits/ceremony/phase2"
snarkjs zkey verify \
  "$REPO_ROOT/circuits/task_completion/build/task_completion.r1cs" \
  "$REPO_ROOT/circuits/ceremony/phase1/powersOfTau28_hez_final_15.ptau" \
  task_completion_final.zkey
```

## 4. Recompute the exported VK and compare

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT/circuits/ceremony/phase2"
snarkjs zkey export verificationkey \
  task_completion_final.zkey \
  verification_key.recomputed.json
diff -u verification_key.recomputed.json verification_key.json
```

## 5. Cross-check the metadata

Make sure `verification_key.meta.json` matches the actual final artifact:

- `status` is `production`
- `freeze_commit` matches the checked-out git commit
- `final_zkey_sha256` matches the final zkey you verified
- transcript / host URLs are populated

Only after those checks pass should the VK be uploaded and activated on-chain.
