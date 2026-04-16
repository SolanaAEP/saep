---
status: draft
target: sendaifun/solana-agent-kit (branch v2)
owner: @0xlinnet
blocked_by: packages/sak-plugin must publish to npm first
---

# Sendai upstream PR — list `@saep/sak-plugin` as a community plugin

## Goal
Get SAK users to discover SAEP from the canonical SAK README without forking Sendai's code. We built `packages/sak-plugin` as an external plugin (spec: `specs/integration-sak.md` §Approach option 2). One-way door avoided: we do NOT want to vendor SAEP into SAK's repo.

## Context about Sendai's plugin surface
- Default branch on `sendaifun/solana-agent-kit` is `v2` (not `main`). Address the PR to `v2`.
- `main` branch is `v1-deprecated`.
- README already lists 5 first-party plugins under `## 📦 Plugin Installation` (lines 124–150 as of 2026-04-16): `plugin-token`, `plugin-nft`, `plugin-defi`, `plugin-misc`, `plugin-blinks`. They share the `@solana-agent-kit/*` npm scope, which Sendai owns — our package cannot slot in there.
- No existing "Community" / "Ecosystem" / "Third-party plugins" section to append to. Adding one is the PR.
- CONTRIBUTING.md says: fork → feature branch → PR against `main` — but since default is now `v2`, confirm target with maintainers via an Issue before PR (see Step 0).

## Pre-flight (blocking)
1. Publish `@saep/sak-plugin` to npm under a namespace we control (`@saep/sak-plugin` or rename to `@buildonsaep/sak-plugin`). `packages/sak-plugin/package.json` currently marks the package private and is workspace-linked; will not resolve for SAK users outside the SAEP monorepo.
2. Stand up a live devnet demo agent whose `operator` keypair is pre-funded + registered — the README entry should link to a one-command repro.
3. Record a 30–60s terminal cast (asciinema or mp4) of `examples/sak-demo/` running register → list → bid → submit. PRs without proof of life get closed.

## Step 0 — open an issue first
Cheaper than a rejected PR. Title + body:

```
Title: [RFC] Community plugin registry — ecosystem plugins outside the @solana-agent-kit scope

Body:
Hi Sendai team — we've shipped @saep/sak-plugin (Solana Agent Economy Protocol)
as an external SAK plugin. It uses the public plugin API (`agent.use(plugin)`)
and does not require forking this repo.

Before we open a PR, we'd like to know:
  (a) Is there an existing process to register ecosystem plugins in the README?
  (b) If not, would a new "Community plugins" section at the bottom of the
      plugin list be acceptable? We're happy to draft it.

For reference: https://github.com/SolanaAEP/saep (monorepo) and an npm package
link once we publish.
```

## Step 1 — PR (only after Step 0 gets a green light)

### Branch naming
`docs/community-plugins-section`

### Diff target
`README.md` — insert a new subsection immediately after the first-party plugin list (between current lines 135 and 137, i.e. after the `npm install …` block and before `## Quick Start`).

### Exact added markdown
```markdown

### Community plugins

Plugins maintained by third parties using SAK's public plugin API. Not audited
or endorsed by SendAI — use at your own risk.

- `@saep/sak-plugin` — Solana Agent Economy Protocol (SAEP). Register your SAK
  agent as an on-chain actor, commit-reveal bid on tasks, submit proof-gated
  results, manage a per-agent Token-2022 treasury.
  ([repo](https://github.com/SolanaAEP/saep/tree/main/packages/sak-plugin) ·
  [demo](https://github.com/SolanaAEP/saep/tree/main/examples/sak-demo))

To propose a plugin: open an issue using the "Community plugin registration"
template.
```

Keep the PR to README only. Do NOT add the issue template in the same PR — split
it. Reviewers hate omnibus docs PRs.

### PR title + body
```
Title: docs: add Community plugins section to README

Body:
## Motivation
SAK has a clean plugin API (`agent.use(plugin)`), but there's no surface in the
README for plugins developed outside the @solana-agent-kit npm scope. This PR
adds a short "Community plugins" subsection under Plugin Installation.

## Why include @saep/sak-plugin as the first entry
Working plugin built against SAK v2 API:
- Exposes 5 actions: SAEP_REGISTER_AGENT, SAEP_LIST_TASKS, SAEP_BID,
  SAEP_REVEAL_BID, SAEP_SUBMIT_RESULT.
- Full zod arg schemas, LLM-routing similes + examples per action.
- Runs against devnet today; demo agent at examples/sak-demo/.
- Live on [asciinema link] / [mp4 link].

## Scope
- README only. No code changes.
- If the team prefers a separate `COMMUNITY_PLUGINS.md` file, happy to split.

## Precedent
Happy to help draft a contribution template for future plugin submissions in a
follow-up PR — tracked in #<issue number from Step 0>.

Refs #<issue number from Step 0>.
```

### Open command (after fork lands at `0xlinnet/solana-agent-kit`)
```bash
cd ~/Projects
gh repo fork sendaifun/solana-agent-kit --clone --remote=false
cd solana-agent-kit
git checkout v2
git checkout -b docs/community-plugins-section
# edit README.md — insert block from above
git commit -am "docs: add Community plugins section to README"
git push -u origin docs/community-plugins-section

gh pr create \
  --repo sendaifun/solana-agent-kit \
  --base v2 \
  --head 0xlinnet:docs/community-plugins-section \
  --title "docs: add Community plugins section to README" \
  --body-file /tmp/pr-body.md
```

## Non-goals
- Do not port SAEP into SAK's plugin scope. First-party requires Sendai's
  maintenance burden; we'd rather own velocity.
- Do not ask for a featured slot or marketing push. That's an M2 conversation
  after audit.
- Do not submit with the workspace-linked package.json (pre-flight #1).

## Open questions
- Q: Should we register under `@saep/sak-plugin` or rename for external
  discoverability (`@buildonsaep/sak-plugin`)? Decide before npm publish.
- Q: Does Sendai maintain a plugin marketplace mentioned in
  specs/integration-sak.md? Confirm via Step 0 issue.
- Q: Who signs the Sendai PR on our side? SAEP repos enforce rotation identity
  via scripts/commit-as.sh — an external PR should carry a stable public
  identity (0xlinnet) not a rotation persona.
