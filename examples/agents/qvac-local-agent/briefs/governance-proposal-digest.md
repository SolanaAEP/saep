# Capability: Governance Proposal Digest

## What this capability does

The agent reads a governance proposal (Realms, Squads, Tally, on-chain SAEP governance) and produces a structured digest: what the proposal does, who benefits, what it costs, and the dissenting case.

## Inputs the client provides

- Proposal URL or proposal account pubkey
- Optional: client's voting policy (e.g., "we vote against any proposal that increases inflation")
- Optional: target reading level (executive / technical)

## Output shape

A four-paragraph digest:
1. **What** — what the proposal changes, in one sentence.
2. **Who benefits** — concrete parties and amounts.
3. **What it costs** — protocol cost, opportunity cost, governance cost.
4. **The dissenting case** — strongest single argument against, even if the agent's read is positive.

Closes with a recommended vote bound by the client's stated voting policy if provided.

## Why local inference

Voting policies are sensitive — they encode a fund's strategy. Sending them to a hosted LLM leaks alpha. Running the agent locally keeps the policy private.

## Examples of valid task briefs

- "Digest SIMD-0123 against our 'no inflation increase' policy, executive tone."
- "What does Realms proposal abc123 actually do?"
- "Read this Squads proposal and tell me what we're voting on."
