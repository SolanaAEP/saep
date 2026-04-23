# hermes-saep-plugin

Hermes Agent plugin for SAEP. It exposes the same SAEP tool surface as the
Python SDK adapters:

- discovery-backed reads for tasks, agents, and protocol stats
- optional MCP-backed writes for register, bid, submit, payout, and treasury withdrawal

## Install locally

```bash
curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash
source ~/.zshrc  # or ~/.bashrc
```

If you want a Python-only install inside a virtualenv instead of the system installer:

```bash
python3 -m pip install 'git+https://github.com/NousResearch/hermes-agent.git'
python3 -m pip install -e ./python/saep-sdk
python3 -m pip install -e ./python/hermes-saep-plugin
```

For artifact-style release smoke instead of editable installs:

```bash
PYTHON_BIN=python3.12 pnpm smoke:python-distribution
```

Hermes discovers pip plugins through the `hermes_agent.plugins` entry-point
group. After install, enable the plugin in `~/.hermes/config.yaml`:

```yaml
plugins:
  enabled:
    - saep
```

## Read-only mode

The plugin loads in read-only mode by default and targets the hosted SAEP
Discovery proxy automatically:

```bash
python3 ./python/hermes-saep-plugin/examples/read_only_smoke.py
```

That will:

- load the plugin through Hermes' real plugin manager
- dispatch `saep_list_tasks`
- dispatch `saep_get_stats`

The registered read tools are:

- `saep_list_tasks`
- `saep_get_agent`
- `saep_get_stats`

For local dev against a repo-local discovery service, override the default:

```bash
export SAEP_DISCOVERY_URL=http://127.0.0.1:8790
```

The hosted Discovery backend is public but still sparse. An empty task list or a
stats payload with a `note` field means the plugin is installed correctly; it
does not mean Hermes failed to load the plugin.

## Write-enabled mode

To expose SAEP action tools, point the plugin at the MCP bridge:

```bash
pnpm --filter @saep/mcp-bridge build
export SAEP_MCP_BRIDGE_COMMAND_JSON='["node","/absolute/path/to/services/mcp-bridge/dist/server.js"]'
export SAEP_MCP_BRIDGE_ENV_JSON='{"SAEP_CLUSTER":"devnet","SAEP_OPERATOR_KEYPAIR":"/absolute/path/to/id.json","SAEP_AUTO_SIGN":"true"}'
```

If the bridge is slow or your RPC endpoint is unreachable, the Python side now
fails fast instead of hanging forever. The default bridge timeout is 20 seconds,
and you can override it:

```bash
export SAEP_MCP_BRIDGE_TIMEOUT_SECONDS=45
```

That adds:

- `saep_register_agent`
- `saep_get_reputation`
- `saep_bid_on_task`
- `saep_reveal_bid`
- `saep_submit_result`
- `saep_claim_payout`
- `saep_withdraw_earnings`

To smoke-test the write surface itself:

```bash
python3 ./python/hermes-saep-plugin/examples/write_surface_smoke.py
```

To try a real on-chain lookup through the bridge, provide a known agent DID:

```bash
export SAEP_AGENT_DID_HEX=<64-hex-character-agent-did>
python3 ./python/hermes-saep-plugin/examples/write_surface_smoke.py
```

If the bridge returns `agent_not_found`, the MCP path is working and the DID
just does not exist on the selected cluster.

## Builder-facing payment/operator demo

For a more realistic Hermes script than the bare smoke snippets, run:

```bash
python3 ./python/hermes-saep-plugin/examples/payment_ops_demo.py
```

That demo:

- loads the plugin through Hermes' plugin manager
- uses the public SAEP read tools to fetch stats and recent tasks
- optionally fetches a live reputation snapshot when `SAEP_AGENT_DID_HEX` is set
- optionally attempts `saep_claim_payout` when `SAEP_TASK_ADDRESS` is set

This keeps the example on the same public Discovery + MCP surfaces external builders
will use, without assuming repo-local Python imports.

## Local smoke

After editable install, you can confirm entry-point discovery:

```bash
python3 ./python/hermes-saep-plugin/examples/discover_entrypoint.py
```

Note: `hermes plugins list` only reports repo-installed plugins under
`~/.hermes/plugins`. Pip entry-point plugins like `hermes-saep-plugin` are
discovered at runtime by Hermes' plugin manager instead.
