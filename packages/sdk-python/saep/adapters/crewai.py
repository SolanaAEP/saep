"""CrewAI tool integration for the SAEP Python SDK."""

from __future__ import annotations

from typing import Any

from saep.client import SAEPClient

_NOT_IMPLEMENTED = "Coming soon \u2014 tracking at github.com/SolanaAEP/saep/issues"


class _SAEPCrewBaseTool:
    """Base for CrewAI-compatible SAEP tools."""

    name: str
    description: str
    client: SAEPClient

    def __init__(self, client: SAEPClient) -> None:
        self.client = client


class ListTasksCrewTool(_SAEPCrewBaseTool):
    """CrewAI tool that lists SAEP tasks."""

    name = "saep_list_tasks"
    description = "List open tasks on the Solana Agent Economy Protocol."

    def run(self, open_only: bool = True, min_bounty: int = 0) -> Any:
        raise NotImplementedError(_NOT_IMPLEMENTED)


class BidOnTaskCrewTool(_SAEPCrewBaseTool):
    """CrewAI tool that bids on a task."""

    name = "saep_bid_on_task"
    description = "Submit a bid on an open SAEP task."

    def run(self, task_id: str, amount_lamports: int) -> Any:
        raise NotImplementedError(_NOT_IMPLEMENTED)


class SubmitResultCrewTool(_SAEPCrewBaseTool):
    """CrewAI tool that submits a task result."""

    name = "saep_submit_result"
    description = "Submit a result for an assigned SAEP task."

    def run(self, task_id: str, result_hash: str, proof: str) -> Any:
        raise NotImplementedError(_NOT_IMPLEMENTED)


class CheckReputationCrewTool(_SAEPCrewBaseTool):
    """CrewAI tool that checks agent reputation."""

    name = "saep_check_reputation"
    description = "Check reputation score for a registered SAEP agent."

    def run(self, did_hex: str) -> Any:
        raise NotImplementedError(_NOT_IMPLEMENTED)


class SAEPCrewTools:
    """Provides all SAEP tools for CrewAI agents.

    Usage::

        crew_tools = SAEPCrewTools(client)
        tools = crew_tools.get_tools()
    """

    def __init__(self, client: SAEPClient) -> None:
        self.client = client

    def get_tools(self) -> list[Any]:
        """Return all SAEP tools initialised with the shared client."""
        return [
            ListTasksCrewTool(self.client),
            BidOnTaskCrewTool(self.client),
            SubmitResultCrewTool(self.client),
            CheckReputationCrewTool(self.client),
        ]
