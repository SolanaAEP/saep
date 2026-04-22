# Phase 1 - Pinned Powers of Tau

This directory records the exact shared Phase 1 artifact used for the SAEP
production ceremony.

Fill in these fields before Phase 2 begins:

- Filename: `powersOfTau28_hez_final_15.ptau`
- Source URL: `<SOURCE_URL>`
- SHA-256: `<SHA256>`
- BLAKE2b: `<BLAKE2B>`
- Downloaded at: `<UTC_TIMESTAMP>`
- Ceremony freeze commit: `<GIT_COMMIT>`
- Verified independently by:
  - `<NAME / HANDLE> - <DATE>`
  - `<NAME / HANDLE> - <DATE>`
  - `<NAME / HANDLE> - <DATE>`

Suggested local workflow:

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT/circuits/ceremony/phase1"
curl -L <SOURCE_URL> -o powersOfTau28_hez_final_15.ptau
shasum -a 256 powersOfTau28_hez_final_15.ptau
snarkjs powersoftau verify powersOfTau28_hez_final_15.ptau
```

The exact reproducibility steps live in `VERIFY.md`.
