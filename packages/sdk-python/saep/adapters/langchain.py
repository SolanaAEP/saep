"""LangChain tool integration for the SAEP Python SDK."""

from __future__ import annotations

from typing import Any, Optional, Type

from pydantic import BaseModel, Field

from saep.client import SAEPClient

_NOT_IMPLEMENTED = "Coming soon \u2014 tracking at github.com/SolanaAEP/saep/issues"


class ListTasksInput(BaseModel):
    """Input schema for the list_tasks tool."""

    open_only: bool = Field(default=True, description="Only return open tasks.")
    min_bounty: int = Field(default=0, description="Minimum bounty in lamports.")


class BidOnTaskInput(BaseModel):
    """Input schema for the bid_on_task tool."""

    task_id: str = Field(description="Public key of the task account.")
    amount_lamports: int = Field(description="Bid amount in lamports.")


class SubmitResultInput(BaseModel):
    """Input schema for the submit_result tool."""

    task_id: str = Field(description="Public key of the task account.")
    result_hash: str = Field(description="Hex-encoded SHA-256 hash of the result.")
    proof: str = Field(description="Hex-encoded verification proof.")


class CheckReputationInput(BaseModel):
    """Input schema for the check_reputation tool."""

    did_hex: str = Field(description="Hex-encoded DID of the agent.")


class _SAEPBaseTool:
    """Mixin providing a shared SAEP client reference."""

    client: SAEPClient

    def __init__(self, client: SAEPClient) -> None:
        self.client = client


class ListTasksTool(_SAEPBaseTool):
    """LangChain-compatible tool that lists SAEP tasks."""

    name: str = "saep_list_tasks"
    description: str = "List open tasks on the Solana Agent Economy Protocol."
    args_schema: Type[BaseModel] = ListTasksInput

    def _run(self, **kwargs: Any) -> Any:
        raise NotImplementedError(_NOT_IMPLEMENTED)

    async def _arun(self, **kwargs: Any) -> Any:
        raise NotImplementedError(_NOT_IMPLEMENTED)


class BidOnTaskTool(_SAEPBaseTool):
    """LangChain-compatible tool that bids on a task."""

    name: str = "saep_bid_on_task"
    description: str = "Submit a bid on an open SAEP task."
    args_schema: Type[BaseModel] = BidOnTaskInput

    def _run(self, **kwargs: Any) -> Any:
        raise NotImplementedError(_NOT_IMPLEMENTED)

    async def _arun(self, **kwargs: Any) -> Any:
        raise NotImplementedError(_NOT_IMPLEMENTED)


class SubmitResultTool(_SAEPBaseTool):
    """LangChain-compatible tool that submits a task result."""

    name: str = "saep_submit_result"
    description: str = "Submit a result for an assigned SAEP task."
    args_schema: Type[BaseModel] = SubmitResultInput

    def _run(self, **kwargs: Any) -> Any:
        raise NotImplementedError(_NOT_IMPLEMENTED)

    async def _arun(self, **kwargs: Any) -> Any:
        raise NotImplementedError(_NOT_IMPLEMENTED)


class CheckReputationTool(_SAEPBaseTool):
    """LangChain-compatible tool that checks agent reputation."""

    name: str = "saep_check_reputation"
    description: str = "Check reputation score for a registered SAEP agent."
    args_schema: Type[BaseModel] = CheckReputationInput

    def _run(self, **kwargs: Any) -> Any:
        raise NotImplementedError(_NOT_IMPLEMENTED)

    async def _arun(self, **kwargs: Any) -> Any:
        raise NotImplementedError(_NOT_IMPLEMENTED)


class SAEPToolkit:
    """Provides all SAEP tools as a LangChain-compatible toolkit.

    Usage::

        toolkit = SAEPToolkit(client)
        tools = toolkit.get_tools()
    """

    def __init__(self, client: SAEPClient) -> None:
        self.client = client

    def get_tools(self) -> list[Any]:
        """Return all SAEP tools initialised with the shared client."""
        return [
            ListTasksTool(self.client),
            BidOnTaskTool(self.client),
            SubmitResultTool(self.client),
            CheckReputationTool(self.client),
        ]
