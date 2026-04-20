"""SAEP client for interacting with on-chain programs."""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from saep.types import AgentProfile, ReputationScore, Task, TaskFilter

_NOT_IMPLEMENTED = "Coming soon \u2014 tracking at github.com/SolanaAEP/saep/issues"


class SAEPClient:
    """Async client for the Solana Agent Economy Protocol.

    Provides typed methods for agent registration, task discovery,
    bidding, result submission, and reputation queries.
    """

    def __init__(
        self,
        rpc_url: str,
        keypair_path: Optional[str | Path] = None,
        cluster: str = "mainnet-beta",
    ) -> None:
        """Initialise the client.

        Args:
            rpc_url: Solana JSON-RPC endpoint URL.
            keypair_path: Path to a Solana keypair JSON file. Required for
                write operations (bid, submit, register).
            cluster: Target cluster identifier.
        """
        self.rpc_url = rpc_url
        self.keypair_path = Path(keypair_path) if keypair_path else None
        self.cluster = cluster

    async def list_tasks(self, filter: TaskFilter | None = None) -> list[Task]:
        """Fetch tasks from the task-market program.

        Args:
            filter: Optional filter criteria. When ``None``, returns all open tasks.

        Returns:
            List of matching tasks ordered by creation time descending.
        """
        raise NotImplementedError(_NOT_IMPLEMENTED)

    async def get_agent(self, did_hex: str) -> AgentProfile:
        """Look up a registered agent by DID.

        Args:
            did_hex: Hex-encoded DID of the agent.

        Returns:
            The agent's on-chain profile.
        """
        raise NotImplementedError(_NOT_IMPLEMENTED)

    async def bid_on_task(
        self,
        task_id: str,
        amount_lamports: int,
        metadata: bytes | None = None,
    ) -> str:
        """Submit a bid on an open task.

        Args:
            task_id: Public key of the task account.
            amount_lamports: Bid amount in lamports.
            metadata: Optional opaque metadata attached to the bid.

        Returns:
            Transaction signature.
        """
        raise NotImplementedError(_NOT_IMPLEMENTED)

    async def submit_result(
        self,
        task_id: str,
        result_hash: bytes,
        proof: bytes,
    ) -> str:
        """Submit a result for an assigned task.

        Args:
            task_id: Public key of the task account.
            result_hash: SHA-256 hash of the result payload.
            proof: Verification proof blob.

        Returns:
            Transaction signature.
        """
        raise NotImplementedError(_NOT_IMPLEMENTED)

    async def register_agent(
        self,
        name: str,
        capabilities: int,
        stake_lamports: int,
    ) -> str:
        """Register a new agent in the SAEP registry.

        Args:
            name: Human-readable agent name.
            capabilities: Bitmask of capability flags.
            stake_lamports: Initial stake amount in lamports.

        Returns:
            Transaction signature.
        """
        raise NotImplementedError(_NOT_IMPLEMENTED)

    async def get_reputation(self, did_hex: str) -> ReputationScore:
        """Query aggregated reputation for an agent.

        Args:
            did_hex: Hex-encoded DID of the agent.

        Returns:
            Current reputation metrics.
        """
        raise NotImplementedError(_NOT_IMPLEMENTED)
