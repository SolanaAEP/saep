# Semgrep rule set — SAEP programs

Runs weekly via `.github/workflows/security-scan.yml` and is intended as an
audit-prep gate, not a replacement for manual review.

## Configs

- `.semgrep/solana.yml` — custom Solana/Anchor rules, scoped to `programs/`.
  Patterns flag known Solana foot-guns (direct lamport mutation, raw account
  data deserialization, wrapping arithmetic on program state, unchecked
  `realloc`, block-time equality, raw `data.borrow_mut`).
- `p/rust` — Semgrep Registry Rust generics (unsafe detection, common
  panics). Pulled at scan time.

The original backlog item referenced a "solana-security-auditor-rules"
community pack. No such pack exists on either the Semgrep Registry or on
GitHub (verified 2026-04-16 — Ackee-Blockchain has no such repo, and a
keyword search for `solana+semgrep` / `anchor+semgrep` across GitHub returns
zero hits). The custom `solana.yml` is the replacement; see INBOX for the
decision note and alternatives considered.

## Policy

The weekly scan fails the pipeline on any finding from either config that
isn't suppressed at source via an inline `// nosemgrep: <rule-id> — reason`
comment. Rationale for every suppression must appear on the comment line so
OtterSec can read the suppression reason without chasing a separate baseline
file.

## Baseline — intentional suppressions as of 2026-04-16

All live at `programs/proof_verifier/src/pairing.rs`. Context: the file
implements bn254 pairing-check via direct `sol_alt_bn128_group_op` syscalls,
so it needs `unsafe` and modular `wrapping_*` arithmetic that would be
wrong anywhere else in the programs.

| File | Line | Rule | Why suppressed |
| --- | --- | --- | --- |
| `pairing.rs` | 35 | `rust.lang.security.unsafe-usage.unsafe-usage` | alt_bn128 ADD syscall, fixed-size buffers |
| `pairing.rs` | 46 | `rust.lang.security.unsafe-usage.unsafe-usage` | alt_bn128 MUL syscall, fixed-size buffers |
| `pairing.rs` | 54 | `rust.lang.security.unsafe-usage.unsafe-usage` | alt_bn128 PAIRING syscall, slice-based |
| `pairing.rs` | 73 | `saep.solana.wrapping-arithmetic` | bn254 field-element modular subtraction |

## Adding a new rule

1. Add to `.semgrep/solana.yml` with `severity`, `message`, and at least one
   exemplar `pattern-either`.
2. Run `semgrep scan --config=.semgrep/solana.yml --metrics=off programs/`
   locally and confirm zero findings (or suppress with rationale).
3. Commit both the rule and any suppressions in the same change.

## Suppressing a finding

Never use `.semgrepignore` for Rust source files — the rationale rots away
from the call site. Use an inline comment on the line immediately above
the offending expression:

    // nosemgrep: saep.solana.wrapping-arithmetic — bn254 field-element math, not financial.
    let diff = a.wrapping_sub(b);

If the suppression applies to an unsafe block or macro invocation that
spans multiple lines, place the comment on the line of the opening token
(semgrep reports the start line, not the line of the inner expression).
