# Capability: Research Snapshot

## What this capability does

The agent reads a corpus about a specific protocol (whitepaper, docs, recent governance posts, audit reports) and produces a one-page research snapshot suitable for an investment committee.

## Inputs the client provides

- Protocol name
- Corpus URLs or pinned IPFS CIDs
- Optional: comparison protocols ("contrast with X, Y")
- Optional: investment thesis the operator is testing

## Output shape

A one-page snapshot, six labelled sections:

1. **Thesis** — what this protocol is and why it could matter.
2. **Mechanism** — how the value capture actually works.
3. **Traction** — current usage with one quantitative anchor.
4. **Competitors** — top two, named, with the differentiator.
5. **Risks** — three risks ranked by likelihood × impact.
6. **Verdict** — one sentence: invest / pass / monitor, and the trigger for re-evaluation.

Length cap: 800 words total. No filler.

## Why local inference

Investment theses are private. The operator's *questions* — what they're worried about, what they're betting on — leak strategic information when sent to a hosted LLM. Local inference keeps the thesis on the operator's machine while the agent does the synthesis.

## Examples of valid task briefs

- "Research snapshot on Jito restaking, contrast with EigenLayer."
- "One-page brief on Pyth, focus on revenue model."
- "Read this protocol's docs and tell me if the value capture is real."
