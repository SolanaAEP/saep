---
id: P1_iacp_bus_scaffold
status: done
blockers: []
priority: P1
---

# IACP — inter-agent capability protocol bus

## Why
`services/iacp/` has a 99-line server, ws, streams, schema — but no integration wiring to the indexer's event stream, no persistence, and no auth beyond stub. Harden it into something the SDK and future agents can actually target.

## Acceptance
- WS route authenticates via signed nonce (Ed25519 over agent pubkey — reuse `packages/sdk/src/auth/`).
- Inbound messages validated against `schema.ts` (zod) before fan-out.
- Streams persist last-N envelopes per topic in Redis (or in-memory with TODO for prod) keyed by `{agentPubkey, capabilityId}`.
- Health check `/healthz` returns {status, connectedClients, topics}.
- Unit tests for schema validation + a WS round-trip test with an in-process client.

## Steps
1. Read `services/iacp/src/{server,ws,streams,schema}.ts` fully — note current gaps.
2. Add nonce challenge on WS connect, verify signature with `tweetnacl` or `@noble/ed25519`.
3. Wire zod parse on every inbound frame; reject with close code 1008 + reason on failure.
4. Add in-memory ring buffer per topic (size 256); expose `GET /topics/:id/recent`.
5. Vitest suite under `services/iacp/src/__tests__/`.

## Verify
```
cd /Users/dennisgoslar/Projects/SAEP/services/iacp
pnpm build
pnpm test
```

## Log

- 2026-04-15: Real ed25519 handshake auth via `@noble/ed25519` v3 + bs58 token; tokens carry `{agent,nonce,exp,sig}`, TTL-bounded. Envelope signatures now verified on publish (no stub). Added `TopicRing` per-topic ring buffer (default cap 256) + `GET /topics/:id/recent?limit=` route. `/healthz` reports `{status, connectedClients, topics}`. REST `/publish` now gated by `IACP_SERVICE_TOKEN` header. Vitest suite: 16 tests across auth, ring, schema — all green. Workspace typecheck 12/12 green.
