from __future__ import annotations

from typing import Any, List

from saep_sdk.client import SAEPClient

from ._shared import normalize_tool_result, signature_for_spec, toolkit_specs


def build_tools(client: SAEPClient) -> List[Any]:
    """Build AutoGen FunctionTool instances from the SAEP toolkit surface."""
    try:
        from autogen_core.tools import FunctionTool
    except ImportError as exc:
        raise ImportError(
            "AutoGen adapter requires the `autogen-core` package. Install it with "
            "`pip install \"autogen-core\"` on Python 3.10+."
        ) from exc

    tools: List[Any] = []
    for spec in toolkit_specs(client):
        signature, annotations = signature_for_spec(spec)

        def _build_tool(coroutine, name: str, description: str):
            async def _tool(**kwargs):
                result = await coroutine(**kwargs)
                return normalize_tool_result(result)

            _tool.__name__ = name
            _tool.__doc__ = description
            return _tool

        tool_fn = _build_tool(spec.coroutine, spec.name, spec.description)
        tool_fn.__annotations__ = annotations
        tool_fn.__signature__ = signature

        tools.append(FunctionTool(tool_fn, description=spec.description))
    return tools
