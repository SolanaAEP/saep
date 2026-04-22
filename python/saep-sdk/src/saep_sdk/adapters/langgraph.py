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

    toolkit = [
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

    if client.has_execution_backend:
        async def register_agent(
            capability_bits: List[int],
            metadata_uri: str,
            stake_mint: str,
            operator_token_account: str,
            agent_id_seed: Optional[str] = None,
            stake_amount: str = "0",
            price_lamports: str = "0",
            stream_rate: str = "0",
        ) -> Dict[str, Any]:
            result = await client.register_agent(
                capability_bits=capability_bits,
                metadata_uri=metadata_uri,
                stake_mint=stake_mint,
                operator_token_account=operator_token_account,
                agent_id_seed=agent_id_seed,
                stake_amount=stake_amount,
                price_lamports=price_lamports,
                stream_rate=stream_rate,
            )
            return result.__dict__

        async def get_reputation(agent_did_hex: str, capability_bit: Optional[int] = None) -> Dict[str, Any]:
            result = await client.get_reputation(agent_did_hex, capability_bit=capability_bit)
            return result.__dict__

        async def bid_on_task(
            task_address: str,
            amount_usdc_micro: int,
            agent_did_hex: str,
            bidder_token_account: str,
        ) -> Dict[str, Any]:
            result = await client.bid_on_task(
                task_address=task_address,
                amount_usdc_micro=amount_usdc_micro,
                agent_did_hex=agent_did_hex,
                bidder_token_account=bidder_token_account,
            )
            return result.__dict__

        async def reveal_bid(task_address: str, amount_usdc_micro: int, nonce_hex: str) -> Dict[str, Any]:
            result = await client.reveal_bid(
                task_address=task_address,
                amount_usdc_micro=amount_usdc_micro,
                nonce_hex=nonce_hex,
            )
            return result.__dict__

        async def submit_result(task_address: str, result_hash: str, proof_key: str) -> Dict[str, Any]:
            result = await client.submit_result(
                task_address=task_address,
                result_hash=result_hash,
                proof_key=proof_key,
            )
            return result.__dict__

        async def claim_payout(
            task_address: str,
            agent_account_address: Optional[str] = None,
            agent_token_account: Optional[str] = None,
        ) -> Dict[str, Any]:
            result = await client.claim_payout(
                task_address=task_address,
                agent_account_address=agent_account_address,
                agent_token_account=agent_token_account,
            )
            return result.__dict__

        async def withdraw_earnings(
            stream_address: str,
            route_data_base64: Optional[str] = None,
            jupiter_program: Optional[str] = None,
            payer_price_feed: Optional[str] = None,
            payout_price_feed: Optional[str] = None,
        ) -> Dict[str, Any]:
            result = await client.withdraw_earnings(
                stream_address=stream_address,
                route_data_base64=route_data_base64,
                jupiter_program=jupiter_program,
                payer_price_feed=payer_price_feed,
                payout_price_feed=payout_price_feed,
            )
            return result.__dict__

        toolkit.extend(
            [
                ToolSpec(
                    name="saep_register_agent",
                    description="Register a SAEP agent via the MCP bridge using capability, pricing, and stake inputs.",
                    parameters={
                        "type": "object",
                        "required": [
                            "capability_bits",
                            "metadata_uri",
                            "stake_mint",
                            "operator_token_account",
                        ],
                        "properties": {
                            "capability_bits": {"type": "array"},
                            "metadata_uri": {"type": "string"},
                            "stake_mint": {"type": "string"},
                            "operator_token_account": {"type": "string"},
                            "agent_id_seed": {"type": "string"},
                            "stake_amount": {"type": "string", "default": "0"},
                            "price_lamports": {"type": "string", "default": "0"},
                            "stream_rate": {"type": "string", "default": "0"},
                        },
                    },
                    coroutine=register_agent,
                ),
                ToolSpec(
                    name="saep_get_reputation",
                    description="Fetch the on-chain reputation snapshot for a specific SAEP agent DID.",
                    parameters={
                        "type": "object",
                        "required": ["agent_did_hex"],
                        "properties": {
                            "agent_did_hex": {"type": "string"},
                            "capability_bit": {"type": "integer"},
                        },
                    },
                    coroutine=get_reputation,
                ),
                ToolSpec(
                    name="saep_bid_on_task",
                    description="Commit a bid on a task and receive the nonce required for the reveal step.",
                    parameters={
                        "type": "object",
                        "required": [
                            "task_address",
                            "amount_usdc_micro",
                            "agent_did_hex",
                            "bidder_token_account",
                        ],
                        "properties": {
                            "task_address": {"type": "string"},
                            "amount_usdc_micro": {"type": "integer"},
                            "agent_did_hex": {"type": "string"},
                            "bidder_token_account": {"type": "string"},
                        },
                    },
                    coroutine=bid_on_task,
                ),
                ToolSpec(
                    name="saep_reveal_bid",
                    description="Reveal a previously committed bid using the saved nonce.",
                    parameters={
                        "type": "object",
                        "required": ["task_address", "amount_usdc_micro", "nonce_hex"],
                        "properties": {
                            "task_address": {"type": "string"},
                            "amount_usdc_micro": {"type": "integer"},
                            "nonce_hex": {"type": "string"},
                        },
                    },
                    coroutine=reveal_bid,
                ),
                ToolSpec(
                    name="saep_submit_result",
                    description="Submit a result hash and proof key for an assigned SAEP task.",
                    parameters={
                        "type": "object",
                        "required": ["task_address", "result_hash", "proof_key"],
                        "properties": {
                            "task_address": {"type": "string"},
                            "result_hash": {"type": "string"},
                            "proof_key": {"type": "string"},
                        },
                    },
                    coroutine=submit_result,
                ),
                ToolSpec(
                    name="saep_claim_payout",
                    description="Claim payout for a verified task after the dispute window closes.",
                    parameters={
                        "type": "object",
                        "required": ["task_address"],
                        "properties": {
                            "task_address": {"type": "string"},
                            "agent_account_address": {"type": "string"},
                            "agent_token_account": {"type": "string"},
                        },
                    },
                    coroutine=claim_payout,
                ),
                ToolSpec(
                    name="saep_withdraw_earnings",
                    description="Withdraw accrued funds from a treasury payment stream.",
                    parameters={
                        "type": "object",
                        "required": ["stream_address"],
                        "properties": {
                            "stream_address": {"type": "string"},
                            "route_data_base64": {"type": "string"},
                            "jupiter_program": {"type": "string"},
                            "payer_price_feed": {"type": "string"},
                            "payout_price_feed": {"type": "string"},
                        },
                    },
                    coroutine=withdraw_earnings,
                ),
            ]
        )

    return toolkit
