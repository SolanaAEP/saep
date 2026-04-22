# Ceremony Coordinator Playbook

This file is for the person SAEP appoints to run the production trusted setup.

The coordinator is an operational owner, not a cryptographic authority. Their
job is to keep the process moving, keep the transcript clean, and make it easy
for independent verifiers to reproduce the result.

## What the coordinator owns

- pin the ceremony freeze commit
- pin the exact Phase 1 `ptau` artifact and its hashes
- publish the participant slate and track approvals
- sequence contributor handoffs
- publish hashes and transcript updates after every contribution
- announce and record the final randomness beacon
- make sure the final VK package lands in `circuits/ceremony/phase2/`
- hand the final production VK to whoever controls the on-chain authority

## What the coordinator does not own

- they do not create trust by themselves
- they do not decide the circuit after freeze
- they do not bypass contributor verification
- they do not decide whether a dev VK can be treated as production

## Recommended coordinator choice

For SAEP right now, the safest default is:

- Primary coordinator: one lead maintainer or founder who can stay responsive
  for 3-5 weeks
- Backup coordinator: one second maintainer who can take over within 48 hours

Good traits:

- reliable daily availability
- comfortable with hashes, git commits, and artifact bookkeeping
- trusted by contributors, but not the only person checking the work
- able to communicate clearly in public

Less important:

- deep zk expertise

The coordinator can lean on the circuit engineer for technical checks.

## Minimum kickoff checklist

- [ ] primary coordinator named
- [ ] backup coordinator named
- [ ] public contact method decided
- [ ] ceremony freeze commit chosen
- [ ] `phase1/README.md` filled with the pinned ptau source and hashes
- [ ] `PARTICIPANT_SLATE.md` filled with initial candidate list
- [ ] storage plan decided for `.zkey` files and transcript mirrors
- [ ] at least 3 independent verifiers identified for the final checks

## Day-to-day runbook

### Before contributions begin

1. Freeze the circuit commit and record it in `PARTICIPANT_SLATE.md` and
   `phase1/README.md`.
2. Download and verify the shared Phase 1 artifact.
3. Build `task_completion_0000.zkey`.
4. Publish the first hash and the starting artifact location.
5. Confirm the next 3-5 contributors in the queue.

### For each contributor

1. Share the current input zkey URL and hash.
2. Confirm the contributor verified the input before contributing.
3. Receive the output zkey URL, hash, and contribution hash.
4. Add their transcript under `phase2/contributions/`.
5. Update the running queue in `PARTICIPANT_SLATE.md`.
6. Announce the next contributor.

### At finalization

1. Choose the future Bitcoin block height for the beacon.
2. Record it in `phase2/BEACON.md`.
3. Apply the beacon and publish the final zkey hash.
4. Ask the independent verifiers to run `phase2/VERIFY.md`.
5. Export `verification_key.json`.
6. Fill in `verification_key.meta.json`.
7. Hand the final package to the on-chain operator for upload.

## Files the coordinator should keep current

- `PARTICIPANT_SLATE.md`
- `phase1/README.md`
- `phase2/README.md`
- `phase2/BEACON.md`
- `phase2/contributions/*.md`

## Immediate next step for SAEP

If no coordinator exists yet, appoint one internal owner today. The ceremony
cannot start cleanly without that person. A simple and honest first move is:

- a lead maintainer becomes primary coordinator
- one trusted teammate becomes backup
- `PARTICIPANT_SLATE.md` gets filled with the first wave of candidate
  contributors

Once that is done, the next operational task is participant outreach, not code.
