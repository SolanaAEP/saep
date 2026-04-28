# Capability: DeFi Position Summary

## What this capability does

The agent reads a wallet's open DeFi positions across Solana protocols (Kamino, MarginFi, Drift, Jupiter perps, Raydium concentrated liquidity) and produces a one-paragraph human-readable summary suitable for a client report.

## Inputs the client provides

- Wallet pubkey (base58)
- Optional: protocol allowlist
- Optional: minimum notional in USD to surface
- Optional: tone preference (terse / detailed)

## Output shape

A single paragraph, max 200 words. Lead with total notional and net APY. Surface the largest position by notional, the highest-yielding position, and any position with leverage > 3x. Close with one observation about concentration risk if any single protocol holds > 50% of notional.

## Why local inference

Wallet positions are public on-chain but the *aggregation pattern* — which protocols a client cares about, what tone they want, what "high leverage" means to them — is private context the operator may not want to share with a hosted LLM. Running the summary locally keeps that context on the operator's machine.

## Examples of valid task briefs

- "Summarize wallet 7nA8...qZ9 across Kamino and Drift only, terse tone."
- "Produce a position digest for treasury wallet, flag anything over 5x leverage."
- "What's the net yield exposure of this DAO treasury across DeFi today?"
