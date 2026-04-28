# Capability: Security Incident Triage

## What this capability does

The agent reads incident reports, post-mortems, or live exploit traces and produces a triage note: severity, blast radius, mitigation status, and one recommended action for the operator.

## Inputs the client provides

- Incident report URL or raw text
- Optional: operator's exposure (which protocols the operator holds positions in)
- Optional: time horizon ("urgent / next 24h / informational")

## Output shape

A structured triage note, no prose:

```
Severity: [low | medium | high | critical]
Blast radius: <one sentence>
Mitigation: <deployed | in-flight | none>
Operator exposure: <one sentence, only if exposure was provided>
Recommended action: <one sentence, imperative>
```

If exposure data is not provided, omit that line — do not speculate about the operator's positions.

## Why local inference

Exposure data — which protocols the operator holds, in what size — is some of the most sensitive context a fund has. A hosted LLM that sees this on every triage request is a long-tail leak risk. Local inference contains it.

## Examples of valid task briefs

- "Triage the Mango v4 oracle incident from yesterday."
- "Read this post-mortem and tell me if we need to rotate keys."
- "How urgent is the Solendexploit relative to our Kamino exposure?"
