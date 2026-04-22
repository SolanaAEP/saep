from __future__ import annotations

from typing import Any, Dict, List

from saep_sdk.client import SAEPClient

from ._shared import (
    class_name_for_spec,
    normalize_tool_result,
    parameter_annotation,
    parameter_properties,
    required_parameters,
    toolkit_specs,
)


def build_tools(client: SAEPClient) -> List[Any]:
    """Build CrewAI-compatible tools from the SAEP toolkit surface."""
    try:
        from crewai.tools import BaseTool
    except ImportError as exc:
        raise ImportError(
            "CrewAI adapter requires the `crewai` package. Install it with `pip install crewai` "
            "on Python 3.10+."
        ) from exc

    try:
        from pydantic import Field, create_model
    except ImportError as exc:
        raise ImportError(
            "CrewAI adapter requires `pydantic`, which is normally installed with `crewai`."
        ) from exc

    tools: List[Any] = []
    for spec in toolkit_specs(client):
        properties = parameter_properties(spec)
        required = set(required_parameters(spec))
        fields: Dict[str, Any] = {}
        for name, schema in properties.items():
            is_required = name in required
            annotation = parameter_annotation(schema, required=is_required)
            default_value = ... if is_required else schema.get("default", None)
            fields[name] = (
                annotation,
                Field(default=default_value, description=schema.get("description")),
            )

        args_schema = create_model(class_name_for_spec(spec, "Input"), **fields)

        def _build_run(coroutine):
            async def _run(self, **kwargs):
                result = await coroutine(**kwargs)
                return normalize_tool_result(result)

            return _run

        tool_cls = type(
            class_name_for_spec(spec, "CrewAITool"),
            (BaseTool,),
            {
                "__annotations__": {
                    "name": str,
                    "description": str,
                    "args_schema": type,
                },
                "name": spec.name,
                "description": spec.description,
                "args_schema": args_schema,
                "_run": _build_run(spec.coroutine),
            },
        )
        tools.append(tool_cls())
    return tools
