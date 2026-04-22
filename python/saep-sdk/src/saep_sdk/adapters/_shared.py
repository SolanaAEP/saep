from __future__ import annotations

import inspect
import re
from typing import Any, Dict, List, Optional, Tuple, Union

from saep_sdk.toolkit import ToolSpec, build_toolkit, normalize_tool_result


def toolkit_specs(client) -> List[ToolSpec]:
    return build_toolkit(client)


def parameter_properties(spec: ToolSpec) -> Dict[str, Dict[str, Any]]:
    return dict(spec.parameters.get("properties", {}))


def required_parameters(spec: ToolSpec) -> List[str]:
    required = spec.parameters.get("required", [])
    if not isinstance(required, list):
        return []
    return [str(name) for name in required]


def parameter_annotation(schema: Dict[str, Any], *, required: bool) -> Any:
    type_name = schema.get("type", "string")
    if type_name == "integer":
        annotation: Any = int
    elif type_name == "number":
        annotation = float
    elif type_name == "boolean":
        annotation = bool
    elif type_name == "array":
        annotation = List[Any]
    elif type_name == "object":
        annotation = Dict[str, Any]
    else:
        annotation = str
    if required:
        return annotation
    return Optional[annotation]


def parameter_default(schema: Dict[str, Any], *, required: bool) -> Any:
    if required:
        return inspect._empty
    return schema.get("default", None)


def signature_for_spec(spec: ToolSpec) -> Tuple[inspect.Signature, Dict[str, Any]]:
    parameters = []
    annotations: Dict[str, Any] = {"return": str}
    required = set(required_parameters(spec))
    for name, schema in parameter_properties(spec).items():
        is_required = name in required
        annotation = parameter_annotation(schema, required=is_required)
        annotations[name] = annotation
        parameters.append(
            inspect.Parameter(
                name=name,
                kind=inspect.Parameter.KEYWORD_ONLY,
                default=parameter_default(schema, required=is_required),
                annotation=annotation,
            )
        )
    return inspect.Signature(parameters), annotations


def class_name_for_spec(spec: ToolSpec, suffix: str) -> str:
    words = [part for part in re.split(r"[^a-zA-Z0-9]+", spec.name) if part]
    base = "".join(word[:1].upper() + word[1:] for word in words) or "SaepTool"
    return f"{base}{suffix}"
