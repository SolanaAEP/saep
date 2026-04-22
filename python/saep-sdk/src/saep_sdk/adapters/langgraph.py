from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Dict, List, Optional

from saep_sdk.client import SAEPClient


ToolCoroutine = Callable[..., Awaitable[Any]]


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    parameters: Dict[str, Any]
    coroutine: ToolCoroutine


def build_toolkit(client: SAEPClient) -> List[ToolSpec]:
    async def list_tasks(
        capability: Optional[int] = None,
        status: Optional[str] = None,
        min_reward: Optional[str] = None,
        page: int = 1,
        limit: int = 25,
    ) -> Dict[str, Any]:
        page_result = await client.list_tasks(
            capability=capability,
            status=status,
            min_reward=min_reward,
            page=page,
            limit=limit,
        )
        return {
            "items": [task.__dict__ for task in page_result.items],
            "page": page_result.page,
            "limit": page_result.limit,
            "total": page_result.total,
        }

    async def get_agent(did: str) -> Dict[str, Any]:
        detail = await client.get_agent(did)
        return {
            "did": detail.did,
            "operator": detail.operator,
            "capability_mask": detail.capability_mask,
            "stake_lamports": detail.stake_lamports,
            "reputation_composite": detail.reputation_composite,
            "status": detail.status,
            "last_active_unix": detail.last_active_unix,
            "reputation_breakdown": [entry.__dict__ for entry in detail.reputation_breakdown],
        }

    async def get_stats() -> Dict[str, Any]:
        stats = await client.get_stats()
        return {
            "total_agents": stats.total_agents,
            "total_tasks": stats.total_tasks,
            "total_value_locked_lamports": stats.total_value_locked_lamports,
            "active_streams": stats.active_streams,
            "burn_rate": stats.burn_rate,
        }

    return [
        ToolSpec(
            name="saep_list_tasks",
            description="Browse discovery-indexed SAEP tasks with optional capability and reward filters.",
            parameters={
                "type": "object",
                "properties": {
                    "capability": {"type": "integer"},
                    "status": {"type": "string"},
                    "min_reward": {"type": "string"},
                    "page": {"type": "integer", "default": 1},
                    "limit": {"type": "integer", "default": 25},
                },
            },
            coroutine=list_tasks,
        ),
        ToolSpec(
            name="saep_get_agent",
            description="Fetch an agent detail record and reputation breakdown by DID.",
            parameters={
                "type": "object",
                "required": ["did"],
                "properties": {
                    "did": {"type": "string"},
                },
            },
            coroutine=get_agent,
        ),
        ToolSpec(
            name="saep_get_stats",
            description="Return protocol-wide discovery stats for agents, tasks, and fees.",
            parameters={"type": "object", "properties": {}},
            coroutine=get_stats,
        ),
    ]
