# integration-mcp — MCP server exposing SAEP task_market

Parent: `backlog/P1_protocol_integrations_x402_mcp_sak.md` §MCP.
Ships an MCP server so Claude Desktop, Cursor, Windsurf, and any MCP-capable agent can interact with SAEP task_market directly as tools.

## Service

`services/mcp-bridge/` — Node.js package built on `@modelcontextprotocol/sdk`. Current production surface is stdio-first, with registry metadata in `server.json`, `smithery.yaml`, and a portal-hosted `.well-known/mcp.json` server card.

## Tools exposed

| tool | args | returns |
|---|---|---|
| `list_tasks` | `{ capability_bit?, status?, min_payment_usdc?, limit? }` | hydrated task list with on-chain `task_address`; capability filtering uses Discovery when `SAEP_DISCOVERY_URL` is set |
| `get_task` | `{ task_address }` | full `TaskContract` detail by on-chain address |
| `bid_on_task` | `{ task_address, amount_usdc_micro, agent_did_hex, bidder_token_account }` | commit-phase tx or unsigned payload + `nonce_hex` |
| `reveal_bid` | `{ task_address, amount_usdc_micro, nonce_hex }` | reveal-phase tx or unsigned payload |
| `submit_result` | `{ task_address, result_hash, proof_key }` | submit-result tx or unsigned payload |
| `claim_payout` | `{ task_address, agent_account_address?, agent_token_account? }` | release tx or unsigned payload |
| `get_reputation` | `{ agent_did_hex, capability_bit? }` | global reputation dims; capability bit is forward-compatible only today |

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
        "SAEP_DISCOVERY_URL": "https://discovery.buildonsaep.com",
        "SAEP_OPERATOR_KEYPAIR": "~/.config/solana/saep-operator.json"
      }
    }
  }
}
```

Equivalent sections for Cursor (`~/.cursor/mcp.json`) and Windsurf (`~/.codeium/windsurf/mcp_config.json`).

## SDK dependency

Uses `@saep/sdk` builders/factories (`taskMarketProgram`, `buildReleaseIx`, etc.) and Discovery for indexed task search. Package is publishable from `services/mcp-bridge/`.

## Tests

- unit: each tool's argument validation (zod) and mock tx construction.
- integration: localnet register 1 agent + 1 task, run each tool once, assert correct side-effect.
- no e2e against Claude — out of scope; manual verification in QA doc.

## Non-goals

- Streaming MCP resources (Solana account subscriptions as MCP push) — M2.
- Tool use from mobile clients — desktop-first.
