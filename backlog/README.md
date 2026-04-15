# SAEP Backlog — Opus Run Loop

Work queue for the automated Claude Opus `/loop` framework. Each item is a self-contained ticket the loop can pick up, execute, and mark done without human mediation.

## Loop protocol

On every tick:
1. `ls backlog/*.md` sorted by priority prefix (`P0_`, `P1_`, `P2_`).
2. Pick first `status: open` item — read its Acceptance + Steps.
3. Implement. Run its listed verification (build, test, lint).
4. On green: set frontmatter `status: done`, append one-line result to `## Log` section, commit with `scripts/commit-as.sh` (pre-commit hook enforces rotation identity).
5. On red: append failure note under `## Log`, leave status `open`, pick the next item.

## Hard blocks (skip, don't burn cycles)

- Anything requiring devnet SOL airdrop — faucets exhausted as of 2026-04-15. Localnet alternatives only until funded.
- Anything touching Render env vars must GET then PUT (see `feedback_render_envvars.md`).
- Git identity: use `scripts/commit-as.sh`, never bare `git commit`.

## Item format

```markdown
---
id: P0_slug
status: open            # open | in_progress | done | blocked
blockers: []            # e.g. ["devnet-sol"]
priority: P0            # P0 critical path, P1 should-have, P2 nice-to-have
---

# Title

## Why
One paragraph — what this unblocks.

## Acceptance
- Bullet list of checkable outcomes.

## Steps
1. Ordered concrete steps.

## Verify
Commands the loop should run to confirm green.

## Log
(appended by loop)
```
