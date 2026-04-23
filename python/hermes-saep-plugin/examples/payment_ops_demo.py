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

    stats = json.loads(registry.dispatch("saep_get_stats", {}))
    tasks = json.loads(registry.dispatch("saep_list_tasks", {"limit": 3}))
    print("stats:", stats)
    print("tasks:", tasks)
    if not tasks["items"]:
        print("note: discovery is reachable, but the current backend returned zero tasks.")

    if "saep_get_reputation" not in tools:
        print(
            "write tools are not enabled. Set SAEP_MCP_BRIDGE_COMMAND_JSON to turn this into a "
            "write-capable payment/operator demo."
        )
        return

    agent_did_hex = os.environ.get("SAEP_AGENT_DID_HEX")
    if agent_did_hex:
        reputation = json.loads(registry.dispatch("saep_get_reputation", {"agent_did_hex": agent_did_hex}))
        print("reputation:", reputation)
        if reputation.get("error") == "agent_not_found":
            print("note: the bridge is working; the supplied agent DID was not found on-chain.")
    else:
        print("tip: set SAEP_AGENT_DID_HEX to fetch a live on-chain reputation snapshot.")

    task_address = os.environ.get("SAEP_TASK_ADDRESS")
    if task_address:
        claim_args = {"task_address": task_address}
        if os.environ.get("SAEP_AGENT_ACCOUNT_ADDRESS"):
            claim_args["agent_account_address"] = os.environ["SAEP_AGENT_ACCOUNT_ADDRESS"]
        if os.environ.get("SAEP_AGENT_TOKEN_ACCOUNT"):
            claim_args["agent_token_account"] = os.environ["SAEP_AGENT_TOKEN_ACCOUNT"]
        payout = json.loads(registry.dispatch("saep_claim_payout", claim_args))
        print("claim_payout:", payout)
    else:
        print(
            "tip: set SAEP_TASK_ADDRESS to try a real payout-claim flow through the same "
            "Hermes + MCP tool surface."
        )


if __name__ == "__main__":
    main()
