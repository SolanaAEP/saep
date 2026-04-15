# integration-mcp — MCP server exposing SAEP task_market

Parent: `backlog/P1_protocol_integrations_x402_mcp_sak.md` §MCP.
Ships an MCP server so Claude Desktop, Cursor, Windsurf, and any MCP-capable agent can interact with SAEP task_market directly as tools.

## Service

`services/mcp-bridge/` — new package. Node.js, `@modelcontextprotocol/sdk`, stdio + streamable-http transports.

## Tools exposed

| tool | args | returns |
|---|---|---|
| `list_tasks` | `{ capability_bit?, status?, min_payment?, limit? }` | array of `{task_id, payload, payment, deadline, client}` |
| `get_task` | `{task_id}` | full `TaskContract` + payload preview |
| `bid_on_task` | `{task_id, amount, nonce?}` | two-phase: returns `commit_sig` then awaits reveal window, auto-reveals |
| `get_bid_status` | `{task_id}` | `{phase, commit_count, reveal_count, winner?, my_bond}` |
| `submit_result` | `{task_id, result_cid, proof_ref}` | `{tx_sig, verified}` |
| `claim_payout` | `{task_id}` | `{tx_sig, amount_released}` |
| `get_reputation` | `{agent_did, capability_bit?}` | category rep scores |
| `list_templates` | `{capability_bit?, author?, limit?}` | from template_registry (post-impl) |

## Resources exposed

- `saep://task/{task_id}` — read-only task view.
- `saep://agent/{agent_did}` — agent profile + reputation summary.
- `saep://bids/{task_id}` — bid book.

## Auth model

MCP server runs locally next to user's wallet. User configures wallet pubkey + operator key (file path or hardware wallet adapter). All ix tools return **unsigned transactions** by default; the MCP client signs. A `--auto-sign` flag (off by default) signs with the configured keypair.

## Config surface

`docs/mcp-setup.md` ships JSON snippets for:

```jsonc
// Claude Desktop: ~/Library/Application Support/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "saep": {
      "command": "npx",
      "args": ["-y", "@saep/mcp-bridge"],
      "env": {
        "SAEP_CLUSTER": "devnet",
        "SAEP_OPERATOR_KEYPAIR": "~/.config/solana/saep-operator.json"
      }
    }
  }
}
```

Equivalent sections for Cursor (`~/.cursor/mcp.json`) and Windsurf (`~/.codeium/windsurf/mcp_config.json`).

## SDK dependency

Uses `@saep/sdk` factories (`taskMarketProgram`, etc.) — no raw account decoding. Package published privately via pnpm workspace; public release post-M1.

## Tests

- unit: each tool's argument validation (zod) and mock tx construction.
- integration: spin localnet + register 1 agent + 1 task, run each tool once, assert correct side-effect.
- no e2e against Claude — out of scope; manual verification in QA doc.

## Non-goals

- Streaming MCP resources (Solana account subscriptions as MCP push) — M2.
- Tool use from mobile clients — desktop-first.
