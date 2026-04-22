# Verify Phase 1

Use these commands to independently verify the pinned Phase 1 artifact and the
frozen `task_completion` circuit inputs that will feed Phase 2.

## 1. Check out the frozen circuit commit

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"
git checkout <CEREMONY_FREEZE_COMMIT>
```

## 2. Rebuild the circuit artifacts

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT/circuits"
pnpm install
cd task_completion
bash scripts/compile.sh
shasum -a 256 build/task_completion.r1cs
```

Record the resulting hash in the ceremony transcript.

## 3. Verify the downloaded ptau

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT/circuits/ceremony/phase1"
shasum -a 256 powersOfTau28_hez_final_15.ptau
snarkjs powersoftau verify powersOfTau28_hez_final_15.ptau
```

## 4. Cross-check the expected values

Make sure all of the following match the published ceremony inputs:

- frozen git commit
- `task_completion.r1cs` hash
- `powersOfTau28_hez_final_15.ptau` hash
- the source URL recorded in `README.md`

Any mismatch is a stop sign. Do not start Phase 2 until all four line up.
