from __future__ import annotations

import importlib.metadata as metadata


class FakeContext:
    def __init__(self) -> None:
        self.tools: list[str] = []

    def register_tool(self, name, toolset, schema, handler, **kwargs):
        self.tools.append(name)


def main() -> None:
    entry_points = metadata.entry_points()
    if hasattr(entry_points, "select"):
        group = entry_points.select(group="hermes_agent.plugins")
    else:
        group = entry_points.get("hermes_agent.plugins", [])

    plugin = next((entry_point for entry_point in group if entry_point.name == "saep"), None)
    if plugin is None:
        raise SystemExit("saep entry point not found in hermes_agent.plugins")

    ctx = FakeContext()
    plugin.load().register(ctx)
    print(sorted(ctx.tools))
    print("discovered via hermes_agent.plugins entry point")


if __name__ == "__main__":
    main()
