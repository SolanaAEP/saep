## Summary

<!-- One paragraph: what changed and why. Reference the spec. -->

Implements: `specs/<feature>.md`

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation / spec only
- [ ] Infrastructure / tooling

## On-chain checklist (required if `programs/` or `circuits/` changed)

- [ ] Spec merged and this PR matches it
- [ ] Unit tests cover happy path + every documented failure mode
- [ ] Integration test against `anchor test --validator legacy` passes
- [ ] CU budget measured and within spec target (note any delta below)
- [ ] No `unwrap` / `expect` in program code
- [ ] All account constraints: owner + signer + discriminator + seeds validated
- [ ] State updated before any CPI (no re-entrancy footguns)
- [ ] Events emitted for every state transition
- [ ] Errors typed via `#[error_code]`, no anonymous strings
- [ ] Invariants doc updated if new ones introduced

### CU budget delta

```
before: <instruction>: N CU
after:  <instruction>: M CU
```

### New CPI dependencies

<!-- List any new program/crate this code now calls. "None" is a valid answer. -->

## Circuit checklist (if `circuits/` changed)

- [ ] Constraint count measured and within spec budget
- [ ] Public input ordering documented and stable
- [ ] Test vectors included
- [ ] Trusted-setup impact noted (new circuit? parameter change?)

## Test plan

<!-- How a reviewer can validate this locally. Commands, not prose. -->

## Related

<!-- Issues, prior PRs, audit findings. -->
