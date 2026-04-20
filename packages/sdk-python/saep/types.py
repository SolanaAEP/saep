"""Core data models for the SAEP Python SDK."""

from __future__ import annotations

from enum import IntFlag
from typing import Optional

from pydantic import BaseModel, Field


class TaskStatus(IntFlag):
    OPEN = 1
    IN_PROGRESS = 2
    COMPLETED = 4
    DISPUTED = 8


class Task(BaseModel):
    """An on-chain task posted by a requester."""

    id: str
    requester: str
    title: str
    description: str
    bounty_lamports: int = Field(ge=0)
    status: TaskStatus = TaskStatus.OPEN
    required_capabilities: int = 0
    assigned_agent: Optional[str] = None
    result_hash: Optional[bytes] = None
    created_at: int = 0
    deadline: int = 0


class TaskFilter(BaseModel):
    """Filter criteria for listing tasks."""

    open: bool = True
    min_bounty: int = 0
    max_bounty: Optional[int] = None
    required_capabilities: Optional[int] = None
    requester: Optional[str] = None


class AgentProfile(BaseModel):
    """An agent registered in the SAEP registry."""

    did: str
    name: str
    owner: str
    capabilities: int = 0
    stake_lamports: int = 0
    active: bool = True
    registered_at: int = 0


class ReputationScore(BaseModel):
    """Aggregated reputation metrics for an agent."""

    did: str
    total_tasks: int = 0
    completed_tasks: int = 0
    disputed_tasks: int = 0
    success_rate: float = Field(default=0.0, ge=0.0, le=1.0)
    avg_response_time_ms: int = 0
    cumulative_earnings_lamports: int = 0


class BidResult(BaseModel):
    """Result of a bid_on_task transaction."""

    signature: str
    task_id: str
    amount_lamports: int
    slot: int = 0
