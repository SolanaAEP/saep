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
from .transport import TransportError


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
        bridge_timeout_seconds: Optional[float] = None,
    ) -> None:
        if executor is not None and (
            bridge_command is not None
            or bridge_env is not None
            or bridge_cwd is not None
            or bridge_timeout_seconds is not None
        ):
            raise ValueError("Pass either executor=... or bridge_command/bridge_env/bridge_cwd, not both")
        self._transport: AsyncTransport = transport or UrllibAsyncTransport(base_url)
        if executor is not None:
            self._executor = executor
        elif bridge_command is not None or bridge_env is not None or bridge_cwd is not None:
            self._executor = MCPBridgeExecutor(
                command=bridge_command,
                env=bridge_env,
                cwd=bridge_cwd,
                request_timeout_seconds=bridge_timeout_seconds or 20.0,
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
        payload = await self._read_request(
            "/agents",
            "/v1/discovery/agents",
            {
                "capability": capability,
                "min_reputation": min_reputation,
                "min_stake": min_stake,
                "price_max": price_max,
                "status": status,
                "sort": sort,
                "page": page,
                "limit": limit,
            },
            {
                "capability_mask": _capability_mask_hex(capability),
                "min_reputation": min_reputation,
                "status": status,
                "sort": _public_agent_sort(sort),
                "limit": limit,
            },
        )
        return page_from_dict(payload, agent_summary_from_dict, default_limit=limit)

    async def list_tasks(
        self,
        *,
        capability: Optional[int] = None,
        status: Optional[str] = None,
        min_reward: Optional[str] = None,
        page: int = 1,
        limit: int = 50,
    ) -> Page[TaskSummary]:
        payload = await self._read_request(
            "/tasks",
            "/v1/discovery/tasks",
            {
                "capability": capability,
                "status": status,
                "min_reward": min_reward,
                "page": page,
                "limit": limit,
            },
            {
                "status": status,
                "limit": limit,
            },
        )
        return page_from_dict(payload, task_summary_from_dict, default_limit=limit)

    async def get_agent(self, did: str) -> AgentDetail:
        payload = await self._read_request(
            f"/agents/{did}",
            f"/v1/discovery/agents/{did}",
            None,
            None,
        )
        return agent_detail_from_dict(payload)

    async def get_stats(self) -> ProtocolStats:
        try:
            payload = await self._read_request("/stats", "/v1/discovery/stats", None, None)
        except TransportError as exc:
            if exc.status_code != 404:
                raise
            payload = {
                "total_agents": 0,
                "total_tasks": 0,
                "total_value_locked_lamports": "0",
                "active_streams": 0,
                "burn_rate": {
                    "total_protocol_fees_lamports": "0",
                    "last_24h_lamports": "0",
                },
                "note": "aggregate stats unavailable on this discovery backend",
            }
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
        return await self._executor.call_tool(name, _clean_tool_arguments(arguments))

    async def _read_request(
        self,
        legacy_path: str,
        public_path: str,
        legacy_params: Optional[Mapping[str, object]],
        public_params: Optional[Mapping[str, object]],
    ) -> dict:
        try:
            return await self._transport.request("GET", legacy_path, params=legacy_params)
        except TransportError as exc:
            if exc.status_code != 404:
                raise
        return await self._transport.request("GET", public_path, params=public_params)


def _capability_mask_hex(bit: Optional[int]) -> Optional[str]:
    if bit is None:
        return None
    if bit < 0:
        raise ValueError("capability bit must be non-negative")
    return hex(1 << bit)


def _public_agent_sort(sort: Optional[str]) -> Optional[str]:
    if sort is None:
        return None
    mapping = {
        "reputation_desc": "reputation_desc",
        "recent_desc": "recent_desc",
    }
    return mapping.get(sort, sort)


def _clean_tool_arguments(arguments: Optional[Mapping[str, object]]) -> dict[str, object]:
    return {key: value for key, value in dict(arguments or {}).items() if value is not None}
