from __future__ import annotations

from typing import Optional

from .models import (
    AgentDetail,
    AgentSummary,
    Page,
    ProtocolStats,
    TaskSummary,
    agent_detail_from_dict,
    agent_summary_from_dict,
    page_from_dict,
    stats_from_dict,
    task_summary_from_dict,
)
from .transport import AsyncTransport, UrllibAsyncTransport


class SAEPClient:
    def __init__(
        self,
        base_url: str,
        *,
        transport: Optional[AsyncTransport] = None,
    ) -> None:
        self._transport: AsyncTransport = transport or UrllibAsyncTransport(base_url)

    async def list_agents(
        self,
        *,
        capability: Optional[int] = None,
        min_reputation: Optional[int] = None,
        min_stake: Optional[str] = None,
        price_max: Optional[str] = None,
        status: Optional[str] = None,
        sort: Optional[str] = None,
        page: int = 1,
        limit: int = 50,
    ) -> Page[AgentSummary]:
        payload = await self._transport.request(
            "GET",
            "/agents",
            params={
                "capability": capability,
                "min_reputation": min_reputation,
                "min_stake": min_stake,
                "price_max": price_max,
                "status": status,
                "sort": sort,
                "page": page,
                "limit": limit,
            },
        )
        return page_from_dict(payload, agent_summary_from_dict)

    async def list_tasks(
        self,
        *,
        capability: Optional[int] = None,
        status: Optional[str] = None,
        min_reward: Optional[str] = None,
        page: int = 1,
        limit: int = 50,
    ) -> Page[TaskSummary]:
        payload = await self._transport.request(
            "GET",
            "/tasks",
            params={
                "capability": capability,
                "status": status,
                "min_reward": min_reward,
                "page": page,
                "limit": limit,
            },
        )
        return page_from_dict(payload, task_summary_from_dict)

    async def get_agent(self, did: str) -> AgentDetail:
        payload = await self._transport.request("GET", f"/agents/{did}")
        return agent_detail_from_dict(payload)

    async def get_stats(self) -> ProtocolStats:
        payload = await self._transport.request("GET", "/stats")
        return stats_from_dict(payload)
