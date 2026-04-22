# SAEP Trusted Setup Workspace

This directory is the home for the real production Groth16 ceremony artifacts
for SAEP's `task_completion` circuit.

Current status:
- `phase1/` and `phase2/` are scaffolded for ops
- no production ceremony output has been added yet
- the only VK currently in the repo is still the dev-only file at
  `circuits/task_completion/build/verification_key.json`

Use this directory only for the production ceremony path:
1. pin and verify the shared `ptau`
2. produce the initial circuit-specific `.zkey`
3. collect contributor transcripts and artifact hashes
4. apply the final beacon
5. export `verification_key.json`
6. upload and activate the production VK on-chain

Expected layout:

```text
circuits/ceremony/
├── README.md
├── COORDINATOR.md
├── PARTICIPANT_SLATE.md
├── phase1/
│   ├── README.md
│   └── VERIFY.md
└── phase2/
    ├── README.md
    ├── VERIFY.md
    ├── BEACON.md
    ├── verification_key.json
    ├── verification_key.meta.json
    └── contributions/
        └── TEMPLATE.md
```

Large local files such as `.ptau` and `.zkey` stay gitignored by default. The
small audit trail and final exported `verification_key.json` are intended to be
tracked.

If SAEP does not yet have a ceremony coordinator, start with `COORDINATOR.md`.
