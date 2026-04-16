# ops-mcp-setup — installing @saep/mcp-bridge in Claude Desktop / Cursor / Windsurf

Parent: `backlog/P1_protocol_integrations_x402_mcp_sak.md` §MCP.
Companion to `specs/integration-mcp.md`. Ops-flavored how-to for running the bridge locally against devnet (or mainnet-beta when ready).

## Prereqs

- Node 20+.
- An operator keypair at a known path (e.g. `~/.config/solana/saep-operator.json`). Generate via `solana-keygen new -o ~/.config/solana/saep-operator.json` if absent.
- SAEP agent registered on the target cluster. Use `apps/portal` onboarding or the SDK's `registerAgent` factory.

## Install

Until `@saep/mcp-bridge` is published to npm, run from the monorepo build:

```bash
pnpm --filter @saep/mcp-bridge build
# produces services/mcp-bridge/dist/server.js
```

When published:

```bash
npx -y @saep/mcp-bridge@latest --help
```

## Env vars

| var | default | notes |
|---|---|---|
| `SAEP_CLUSTER` | `devnet` | `localnet` / `devnet` / `mainnet-beta` |
| `SAEP_RPC_URL` | cluster default | override for Helius/Triton |
| `SAEP_OPERATOR_KEYPAIR` | unset | path to Solana keypair JSON |
| `SAEP_AUTO_SIGN` | `false` | set to `true` only if the host process is trusted; default emits unsigned tx for the client to sign |

## Claude Desktop

File: `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows).

```jsonc
{
  "mcpServers": {
    "saep": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/SAEP/services/mcp-bridge/dist/server.js"],
      "env": {
        "SAEP_CLUSTER": "devnet",
        "SAEP_OPERATOR_KEYPAIR": "/Users/you/.config/solana/saep-operator.json"
      }
    }
  }
}
```

Post-publish variant:

```jsonc
{
  "mcpServers": {
    "saep": {
      "command": "npx",
      "args": ["-y", "@saep/mcp-bridge"],
      "env": { "SAEP_CLUSTER": "devnet", "SAEP_OPERATOR_KEYPAIR": "/Users/you/.config/solana/saep-operator.json" }
    }
  }
}
```

## Cursor

File: `~/.cursor/mcp.json`.

```jsonc
{
  "mcpServers": {
    "saep": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/SAEP/services/mcp-bridge/dist/server.js"],
      "env": { "SAEP_CLUSTER": "devnet" }
    }
  }
}
```

## Windsurf

File: `~/.codeium/windsurf/mcp_config.json`.

```jsonc
{
  "mcpServers": {
    "saep": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/SAEP/services/mcp-bridge/dist/server.js"],
      "env": { "SAEP_CLUSTER": "devnet" }
    }
  }
}
```

## Verification

After editing the config file, restart the host (Claude Desktop / Cursor / Windsurf). In a chat:

1. Ask the model to list SAEP tools — should surface `list_tasks`, `get_task`, `get_reputation`, `bid_on_task`, `submit_result`.
2. Call `list_tasks` with no filters — current scaffold returns `{ tasks: [], note: { error: 'NOT_YET_WIRED' } }` until SDK program factories land. Confirms the transport works even before data plane lights up.

## Safety notes

- `SAEP_AUTO_SIGN=true` lets the bridge sign transactions with the operator key directly. Off by default: the bridge returns an unsigned base64 transaction for the MCP client (Claude/Cursor/Windsurf) to sign, keeping the signing surface in the wallet adapter rather than the MCP process.
- Never point the bridge at a mainnet-beta cluster with a hot operator keypair that also holds treasury authority. Use a dedicated low-scope operator key for MCP sessions; reserve the treasury-signing key for a hardware wallet in `apps/portal`.
- The bridge makes RPC calls on every tool invocation. For low-volume devnet use the free RPC is fine; for mainnet set `SAEP_RPC_URL` to a dedicated Helius endpoint to avoid rate limits.

## Troubleshooting

| symptom | check |
|---|---|
| tools don't appear | restart host process; `claude_desktop_config.json` syntax error is silent on many versions |
| `NOT_YET_WIRED` on every call | expected pre-SDK-wiring; track in `backlog/P1_protocol_integrations_x402_mcp_sak.md` |
| `invalid keypair` | ensure the JSON file holds a 64-byte secretKey array, not a base58 string |
| permission denied on server.js | `chmod +x services/mcp-bridge/dist/server.js` after build |
