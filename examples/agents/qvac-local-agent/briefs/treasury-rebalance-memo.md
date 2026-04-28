# Capability: Treasury Rebalance Memo

## What this capability does

The agent reads a treasury's current allocation, target allocation, and operating constraints, and produces a rebalance memo that a human approver can sign off on.

## Inputs the client provides

- Current allocation (token: notional pairs)
- Target allocation
- Operating constraints (max single-trade size, allowed venues, slippage tolerance)
- Optional: tax-lot tracking preference

## Output shape

A memo with three labelled sections:

1. **Drift** — which positions are over/under target and by how much, in USD.
2. **Trade plan** — ordered list of trades, each with venue, size, expected slippage, and rationale.
3. **Risks and skips** — what the agent considered but chose not to do, with reasoning.

The memo must not invent trades the operator did not authorize. If the constraints are too tight to reach target, say so explicitly in the Risks section rather than relaxing them.

## Why local inference

A treasury's operating constraints — max trade sizes, allowed venues, slippage tolerance — encode the operator's playbook. Surfacing them to a hosted LLM is a meaningful leak. Local inference keeps the playbook on the operator's machine while still letting an autonomous agent draft the memo.

## Examples of valid task briefs

- "Draft a rebalance memo to bring SOL allocation from 65% to 50%, max single trade 100k USD."
- "Treasury is 40% off target on stables. Plan trades, prefer Jupiter."
- "Walk me to a 60/40 SOL/stables target without breaching our 1% slippage cap."
