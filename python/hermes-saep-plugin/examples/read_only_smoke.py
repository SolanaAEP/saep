from __future__ import annotations

import json

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
    tasks = json.loads(registry.dispatch("saep_list_tasks", {"limit": 3}))
    stats = json.loads(registry.dispatch("saep_get_stats", {}))

    print("plugin:", plugin_info)
    print("tools:", tools)
    print("tasks:", tasks)
    if not tasks["items"]:
        print("note: discovery is reachable, but the current backend returned zero tasks.")
    print("stats:", stats)
    if stats.get("note"):
        print("note:", stats["note"])


if __name__ == "__main__":
    main()
