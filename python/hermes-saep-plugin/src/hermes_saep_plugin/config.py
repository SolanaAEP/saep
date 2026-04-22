from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Mapping, Optional


DEFAULT_DISCOVERY_URL = "https://buildonsaep.com/api/discovery/v1/discovery"


@dataclass(frozen=True)
class HermesSAEPConfig:
    discovery_url: str = DEFAULT_DISCOVERY_URL
    bridge_command: Optional[tuple[str, ...]] = None
    bridge_env: Optional[dict[str, str]] = None
    bridge_timeout_seconds: Optional[float] = None

    @property
    def has_execution_backend(self) -> bool:
        return bool(self.bridge_command)


def load_config(env: Optional[Mapping[str, str]] = None) -> HermesSAEPConfig:
    source = env or os.environ
    discovery_url = source.get("SAEP_DISCOVERY_URL", DEFAULT_DISCOVERY_URL)
    bridge_command = _parse_command(source.get("SAEP_MCP_BRIDGE_COMMAND_JSON"))
    bridge_env = _parse_env_map(source.get("SAEP_MCP_BRIDGE_ENV_JSON"))
    bridge_timeout_seconds = _parse_timeout(source.get("SAEP_MCP_BRIDGE_TIMEOUT_SECONDS"))
    return HermesSAEPConfig(
        discovery_url=discovery_url,
        bridge_command=bridge_command,
        bridge_env=bridge_env,
        bridge_timeout_seconds=bridge_timeout_seconds,
    )


def _parse_command(raw: Optional[str]) -> Optional[tuple[str, ...]]:
    if raw is None or raw.strip() == "":
        return None
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError("SAEP_MCP_BRIDGE_COMMAND_JSON must be valid JSON") from exc
    if not isinstance(payload, list) or not payload:
        raise ValueError("SAEP_MCP_BRIDGE_COMMAND_JSON must decode to a non-empty JSON array")
    command = tuple(str(part) for part in payload)
    if any(part == "" for part in command):
        raise ValueError("SAEP_MCP_BRIDGE_COMMAND_JSON must not contain empty command elements")
    return command


def _parse_env_map(raw: Optional[str]) -> Optional[dict[str, str]]:
    if raw is None or raw.strip() == "":
        return None
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError("SAEP_MCP_BRIDGE_ENV_JSON must be valid JSON") from exc
    if not isinstance(payload, dict):
        raise ValueError("SAEP_MCP_BRIDGE_ENV_JSON must decode to a JSON object")
    result: dict[str, str] = {}
    for key, value in payload.items():
        if value is None:
            continue
        if isinstance(value, bool):
            result[str(key)] = "true" if value else "false"
        else:
            result[str(key)] = str(value)
    return result


def _parse_timeout(raw: Optional[str]) -> Optional[float]:
    if raw is None or raw.strip() == "":
        return None
    try:
        parsed = float(raw)
    except ValueError as exc:
        raise ValueError("SAEP_MCP_BRIDGE_TIMEOUT_SECONDS must be a positive number") from exc
    if parsed <= 0:
        raise ValueError("SAEP_MCP_BRIDGE_TIMEOUT_SECONDS must be a positive number")
    return parsed
