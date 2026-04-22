from __future__ import annotations

from typing import Any, Mapping

from saep_sdk import SAEPClient
from saep_sdk.toolkit import ToolSpec, build_toolkit, normalize_tool_result

from .config import HermesSAEPConfig, load_config


TOOLSET_NAME = "saep"


def create_client(config: HermesSAEPConfig) -> SAEPClient:
    return SAEPClient(
        config.discovery_url,
        bridge_command=config.bridge_command,
        bridge_env=config.bridge_env,
        bridge_timeout_seconds=config.bridge_timeout_seconds,
    )


def register(ctx) -> SAEPClient:
    return register_with_client(ctx, create_client(load_config()))


def register_with_client(ctx, client: SAEPClient) -> SAEPClient:
    for spec in build_toolkit(client):
        ctx.register_tool(
            name=spec.name,
            toolset=TOOLSET_NAME,
            schema=_schema_for_spec(spec),
            handler=_handler_for_spec(spec),
            is_async=True,
            description=spec.description,
        )
    return client


def _schema_for_spec(spec: ToolSpec) -> dict[str, Any]:
    return {
        "name": spec.name,
        "description": spec.description,
        "parameters": spec.parameters,
    }


def _handler_for_spec(spec: ToolSpec):
    async def _handler(args: Mapping[str, Any], **kwargs: Any) -> str:
        params = dict(args or {})
        result = await spec.coroutine(**params)
        return normalize_tool_result(result)

    return _handler


__all__ = [
    "HermesSAEPConfig",
    "TOOLSET_NAME",
    "create_client",
    "load_config",
    "register",
    "register_with_client",
]
