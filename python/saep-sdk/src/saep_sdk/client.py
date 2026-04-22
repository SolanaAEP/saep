from __future__ import annotations

from typing import Mapping, Optional, Sequence

from .execution import AsyncExecutor, ExecutionError, MCPBridgeExecutor
from .models import (
    AgentDetail,
    AgentRegistrationResult,
    AgentSummary,
    BidResult,
    ClaimPayoutResult,
    Page,
    ProtocolStats,
    ReputationSnapshot,
    RevealResult,
    SubmitResultReceipt,
    TaskSummary,
    WithdrawEarningsResult,
    agent_registration_from_dict,
    agent_detail_from_dict,
    bid_result_from_dict,
    agent_summary_from_dict,
    claim_payout_from_dict,
    page_from_dict,
    reputation_snapshot_from_dict,
    reveal_result_from_dict,
    stats_from_dict,
    submit_result_from_dict,
    task_summary_from_dict,
    withdraw_earnings_from_dict,
)
from .transport import AsyncTransport, UrllibAsyncTransport


class SAEPClient:
    def __init__(
        self,
        base_url: str,
        *,
        transport: Optional[AsyncTransport] = None,
        executor: Optional[AsyncExecutor] = None,
        bridge_command: Optional[Sequence[str]] = None,
        bridge_env: Optional[Mapping[str, str]] = None,
        bridge_cwd: Optional[str] = None,
    ) -> None:
        if executor is not None and (bridge_command is not None or bridge_env is not None or bridge_cwd is not None):
            raise ValueError("Pass either executor=... or bridge_command/bridge_env/bridge_cwd, not both")
        self._transport: AsyncTransport = transport or UrllibAsyncTransport(base_url)
        if executor is not None:
            self._executor = executor
        elif bridge_command is not None or bridge_env is not None or bridge_cwd is not None:
            self._executor = MCPBridgeExecutor(
                command=bridge_command,
                env=bridge_env,
                cwd=bridge_cwd,
            )
        else:
            self._executor = None

    @property
    def has_execution_backend(self) -> bool:
        return self._executor is not None

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

    async def register_agent(
        self,
        *,
        capability_bits: Sequence[int],
        metadata_uri: str,
        stake_mint: str,
        operator_token_account: str,
        agent_id_seed: Optional[str] = None,
        stake_amount: str = "0",
        price_lamports: str = "0",
        stream_rate: str = "0",
    ) -> AgentRegistrationResult:
        payload = await self._call_tool(
            "register_agent",
            {
                "capability_bits": list(capability_bits),
                "metadata_uri": metadata_uri,
                "agent_id_seed": agent_id_seed,
                "stake_amount": stake_amount,
                "stake_mint": stake_mint,
                "operator_token_account": operator_token_account,
                "price_lamports": price_lamports,
                "stream_rate": stream_rate,
            },
        )
        return agent_registration_from_dict(payload)

    async def get_reputation(
        self,
        agent_did_hex: str,
        *,
        capability_bit: Optional[int] = None,
    ) -> ReputationSnapshot:
        payload = await self._call_tool(
            "get_reputation",
            {
                "agent_did_hex": agent_did_hex,
                "capability_bit": capability_bit,
            },
        )
        return reputation_snapshot_from_dict(payload)

    async def bid_on_task(
        self,
        *,
        task_address: str,
        amount_usdc_micro: int,
        agent_did_hex: str,
        bidder_token_account: str,
    ) -> BidResult:
        payload = await self._call_tool(
            "bid_on_task",
            {
                "task_address": task_address,
                "amount_usdc_micro": amount_usdc_micro,
                "agent_did_hex": agent_did_hex,
                "bidder_token_account": bidder_token_account,
            },
        )
        return bid_result_from_dict(payload)

    async def reveal_bid(
        self,
        *,
        task_address: str,
        amount_usdc_micro: int,
        nonce_hex: str,
    ) -> RevealResult:
        payload = await self._call_tool(
            "reveal_bid",
            {
                "task_address": task_address,
                "amount_usdc_micro": amount_usdc_micro,
                "nonce_hex": nonce_hex,
            },
        )
        return reveal_result_from_dict(payload)

    async def submit_result(
        self,
        *,
        task_address: str,
        result_hash: str,
        proof_key: str,
    ) -> SubmitResultReceipt:
        payload = await self._call_tool(
            "submit_result",
            {
                "task_address": task_address,
                "result_hash": result_hash,
                "proof_key": proof_key,
            },
        )
        return submit_result_from_dict(payload)

    async def claim_payout(
        self,
        *,
        task_address: str,
        agent_account_address: Optional[str] = None,
        agent_token_account: Optional[str] = None,
    ) -> ClaimPayoutResult:
        payload = await self._call_tool(
            "claim_payout",
            {
                "task_address": task_address,
                "agent_account_address": agent_account_address,
                "agent_token_account": agent_token_account,
            },
        )
        return claim_payout_from_dict(payload)

    async def withdraw_earnings(
        self,
        *,
        stream_address: str,
        route_data_base64: Optional[str] = None,
        jupiter_program: Optional[str] = None,
        payer_price_feed: Optional[str] = None,
        payout_price_feed: Optional[str] = None,
    ) -> WithdrawEarningsResult:
        payload = await self._call_tool(
            "withdraw_earnings",
            {
                "stream_address": stream_address,
                "route_data_base64": route_data_base64,
                "jupiter_program": jupiter_program,
                "payer_price_feed": payer_price_feed,
                "payout_price_feed": payout_price_feed,
            },
        )
        return withdraw_earnings_from_dict(payload)

    async def aclose(self) -> None:
        if self._executor is not None:
            await self._executor.aclose()

    async def __aenter__(self) -> "SAEPClient":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        await self.aclose()

    async def _call_tool(self, name: str, arguments) -> dict:
        if self._executor is None:
            raise ExecutionError(
                "This SAEPClient has no execution backend configured. "
                "Pass executor=... or bridge_command=... to enable action methods.",
                tool_name=name,
            )
        return await self._executor.call_tool(name, arguments)
