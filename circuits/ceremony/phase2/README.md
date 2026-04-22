# Phase 2 - SAEP Production Ceremony

This directory holds the public audit trail for the real production trusted
setup of the `task_completion` circuit.

Current status:
- no production `.zkey` or production VK has been added yet
- this directory is ready for the real ceremony output

## Required deliverables

- `verification_key.json`
- `verification_key.meta.json`
- `README.md`
- `VERIFY.md`
- `BEACON.md`
- `contributions/*.md`

Large binaries such as `task_completion_0000.zkey` and `task_completion_final.zkey`
can be kept locally or referenced by URL if they are hosted elsewhere.

## Suggested runbook

### 1. Build the initial circuit-specific zkey

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT/circuits/task_completion"
bash scripts/compile.sh
snarkjs groth16 setup \
  build/task_completion.r1cs \
  ../ceremony/phase1/powersOfTau28_hez_final_15.ptau \
  ../ceremony/phase2/task_completion_0000.zkey
```

### 2. Contributor loop

Each contributor starts from the previous zkey:

```bash
snarkjs zkey contribute \
  task_completion_<PREV>.zkey \
  task_completion_<NEXT>.zkey \
  --name="contributor-<HANDLE>" \
  -v \
  -e="$(head -c 64 /dev/urandom | base64)"
```

For every contribution, add a transcript entry under `contributions/`.

### 3. Final beacon

```bash
snarkjs zkey beacon \
  task_completion_<LAST>.zkey \
  task_completion_final.zkey \
  <BITCOIN_BLOCK_HASH_HEX> \
  10 \
  -n="Final Beacon"
```

Record the exact block height and block hash in `BEACON.md`.

### 4. Verify and export the production VK

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT/circuits/ceremony/phase2"
snarkjs zkey verify \
  "$REPO_ROOT/circuits/task_completion/build/task_completion.r1cs" \
  "$REPO_ROOT/circuits/ceremony/phase1/powersOfTau28_hez_final_15.ptau" \
  task_completion_final.zkey

snarkjs zkey export verificationkey \
  task_completion_final.zkey \
  verification_key.json
```

Then copy the example metadata file and fill it in:

```bash
cp verification_key.meta.example.json verification_key.meta.json
```

### 5. Upload and propose on-chain activation

Once the files are final:

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"
ANCHOR_PROVIDER_URL='<MAINNET_RPC_URL>' \
ANCHOR_WALLET="$HOME/.config/solana/saep-mainnet-deployer.json" \
pnpm exec tsx scripts/upload_vk.ts \
  --production \
  --vk-path circuits/ceremony/phase2/verification_key.json \
  --meta-path circuits/ceremony/phase2/verification_key.meta.json
```

If `active_vk` is still unset, that upload flow will also start the 7-day
activation timelock.

## Checklist

- [ ] frozen circuit commit recorded
- [ ] Phase 1 hashes recorded and independently verified
- [ ] every contribution has a transcript and artifact hash
- [ ] final beacon recorded
- [ ] `task_completion_final.zkey` verified independently
- [ ] `verification_key.json` exported and committed
- [ ] `verification_key.meta.json` filled in
- [ ] VK uploaded on-chain with `is_production = true`
- [ ] activation proposed
- [ ] activation executed after the 7-day timelock
