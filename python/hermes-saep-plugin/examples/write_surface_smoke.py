from __future__ import annotations

import json
import os

from hermes_cli.plugins import PluginManager
from tools.registry import registry


def main() -> None:
    manager = PluginManager()
    manager.discover_and_load()
    plugin_info = next((item for item in manager.list_plugins() if item["name"] == "saep"), None)
    if plugin_info is None or not plugin_info["enabled"]:
        raise SystemExit(
            "SAEP plugin is not enabled. Add `plugins:\\n  enabled:\\n    - saep` "
            "to your Hermes config.yaml first."
        )

    tools = registry.get_tool_names_for_toolset("saep")
    print("plugin:", plugin_info)
    print("tools:", tools)

    if "saep_get_reputation" not in tools:
        raise SystemExit(
            "Write tools are not registered. Set SAEP_MCP_BRIDGE_COMMAND_JSON before running this smoke."
        )

    agent_did_hex = os.environ.get("SAEP_AGENT_DID_HEX")
    if not agent_did_hex:
        print(
            "write tools are registered. Set SAEP_AGENT_DID_HEX to run a live reputation lookup "
            "through the MCP bridge."
        )
        return

    result = json.loads(registry.dispatch("saep_get_reputation", {"agent_did_hex": agent_did_hex}))
    print("reputation:", result)
    if result.get("error") == "agent_not_found":
        print("note: the bridge is working; the supplied agent DID was not found on-chain.")


if __name__ == "__main__":
    main()
