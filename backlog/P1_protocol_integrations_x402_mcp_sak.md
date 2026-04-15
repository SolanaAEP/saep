---
id: P1_protocol_integrations_x402_mcp_sak
status: open
blockers: []
priority: P1
---

# Protocol integrations — x402, MCP, Solana Agent Kit

## Why
Three integrations move SAEP from "a Solana protocol" to "part of the agent stack". Ignoring any of them isolates SAEP from the default dev surface. See `reports/strategy-2026-04.md` §Differentiation.

## Acceptance

### x402 HTTP payment rail
- `services/iacp` (or a new `services/x402-gateway`) accepts `402 Payment Required` responses per x402 spec (coinbase.com/developer-platform/discover/launches/x402).
- Settlement maps to `task_market::settle` via USDC on Solana (CCTP v2 if source is EVM).
- Demo: external agent hits a SAEP-hosted endpoint, pays via x402, triggers on-chain settlement.

### MCP server interface
- `services/mcp-bridge` (new) exposes `task_market` as an MCP server per modelcontextprotocol.io.
- Tools: `list_tasks`, `bid_on_task`, `get_bid_status`, `claim_payout`.
- Reference config for Claude Desktop + Cursor + Windsurf in `docs/mcp-setup.md`.

### Solana Agent Kit integration
- Fork `github.com/sendaifun/solana-agent-kit` OR contribute a `@solana-agent-kit/saep` plugin.
- Wraps SDK calls so any existing SAK agent can register, bid, settle, and manage treasury through SAEP.
- Example agent in `examples/sak-demo/`.

## Steps
1. Spec each sub-integration separately: `specs/integration-x402.md`, `specs/integration-mcp.md`, `specs/integration-sak.md`.
2. Parallelize: `scaffolder` for x402 + MCP bridges; SDK-UI engineer for SAK plugin.
3. End-to-end demo per integration before marking done.

## Verify
```
pnpm --filter @saep/x402-gateway test
pnpm --filter @saep/mcp-bridge test
# SAK: run examples/sak-demo against devnet, confirm on-chain settlement
```

## Log

- 2026-04-15: Three sub-specs landed: `specs/integration-x402.md` (gateway service, CCTP bridge fallback, bundle-settled task), `specs/integration-mcp.md` (stdio MCP server with 8 tools, default unsigned-tx output, Claude/Cursor/Windsurf config snippets), `specs/integration-sak.md` (external plugin package, 4 actions for M1). Implementation pending — scaffolder delegation required. Ticket stays open.
- 2026-04-16: `services/mcp-bridge` scaffold shipped — @modelcontextprotocol/sdk stdio server, 5 tools (list_tasks/get_task/get_reputation/bid_on_task/submit_result) with zod arg validation + NOT_YET_WIRED handler sentinel pending SDK program factories. vitest 8/8 green, typecheck + build clean. x402-gateway + sak-plugin scaffolds still pending.
- 2026-04-16: `services/x402-gateway` scaffold shipped — fastify server with /proxy (ed25519 sig verify, URL allow-pattern + allow_list, redis token-bucket rate limit per agent_did, budget cap), /facilitate/verify, /healthz, /metrics. cctp helper with attestation poll + timeout, allowlist matcher, prom metrics registry. Handler bodies return 501 NOT_YET_WIRED pending task_market bundle settlement + indexer settled_tx table. vitest 23/23 green (allowlist, cctp, ratelimit vs ioredis-mock, auth ed25519 round-trip, server inject). sak-plugin still pending.
