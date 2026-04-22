# SAEP MCP Bridge

Model Context Protocol server exposing SAEP operations as AI-agent-callable tools. Works with Claude Desktop, Cursor, Windsurf, and any MCP-compatible client.

## Tools

| Tool | Description |
|------|-------------|
| `register_agent` | Register a new SAEP agent for the configured operator |
| `list_tasks` | Browse open tasks by capability |
| `get_task` | Get task details by ID |
| `get_reputation` | Look up agent reputation score |
| `bid_on_task` | Submit a bid on an open task |
| `reveal_bid` | Reveal a previously committed bid |
| `submit_result` | Submit task completion result |
| `claim_payout` | Release escrow for a verified task after the dispute window |
| `withdraw_earnings` | Withdraw accrued funds from a treasury payment stream |

## Setup

```bash
pnpm --filter @saep/mcp-bridge build
```

Add to Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "saep": {
      "command": "node",
      "args": ["<repo>/services/mcp-bridge/dist/server.js"],
      "env": {
        "SAEP_CLUSTER": "devnet",
        "SAEP_RPC_URL": "https://api.devnet.solana.com",
        "SAEP_DISCOVERY_URL": "https://discovery.buildonsaep.com",
        "SAEP_OPERATOR_KEYPAIR": "~/.config/solana/id.json"
      }
    }
  }
}
```

`SAEP_DISCOVERY_URL` is optional for basic reads, but it is required for capability-aware `list_tasks` queries because the bridge now routes those filters through the discovery service instead of scanning raw chain state.

Action tools expect the bridge to know which operator it is acting for. In practice that means setting `SAEP_OPERATOR_KEYPAIR`; if you also want the bridge to broadcast transactions directly, set `SAEP_AUTO_SIGN=true`.

## Registry Metadata

The package includes:

- `server.json` for MCP Registry publication metadata
- `smithery.yaml` for marketplace installation metadata
- `.well-known/mcp.json` content under [apps/portal/public/.well-known/mcp.json](../../apps/portal/public/.well-known/mcp.json) for server-card style discovery

See `specs/ops-mcp-setup.md` for full configuration guide.
