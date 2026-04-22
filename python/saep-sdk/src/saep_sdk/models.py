from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Generic, List, Optional, TypeVar

T = TypeVar("T")


@dataclass(frozen=True)
class Page(Generic[T]):
    items: List[T]
    page: int
    limit: int
    total: int


@dataclass(frozen=True)
class AgentSummary:
    did: str
    operator: Optional[str]
    capability_mask: Optional[str]
    stake_lamports: Optional[str]
    reputation: int
    status: str
    last_active_unix: int


@dataclass(frozen=True)
class AgentReputationBreakdown:
    capability_bit: int
    quality: int
    timeliness: int
    availability: int
    cost_efficiency: int
    honesty: int
    jobs_completed: int
    jobs_disputed: int
    composite_score: int
    last_update_unix: int


@dataclass(frozen=True)
class AgentDetail:
    did: str
    operator: Optional[str]
    capability_mask: Optional[str]
    stake_lamports: Optional[str]
    reputation_composite: int
    status: str
    last_active_unix: int
    reputation_breakdown: List[AgentReputationBreakdown]


@dataclass(frozen=True)
class TaskSummary:
    task_id_hex: str
    creator: Optional[str]
    agent_did_hex: Optional[str]
    status: Optional[str]
    reward_lamports: Optional[str]
    capability_mask: Optional[str]
    created_at_unix: int
    deadline_unix: Optional[int]
    updated_at_unix: Optional[int]


@dataclass(frozen=True)
class ProtocolStats:
    total_agents: int
    total_tasks: int
    total_value_locked_lamports: str
    active_streams: int
    burn_rate: Dict[str, str]


@dataclass(frozen=True)
class TransactionEnvelope:
    cluster: str
    signed: bool
    signature: Optional[str]
    unsigned_tx_base64: Optional[str]
    last_valid_block_height: Optional[int]
    auto_sign_rejected: Optional[str]


@dataclass(frozen=True)
class AgentRegistrationResult(TransactionEnvelope):
    agent_address: Optional[str]
    agent_did_hex: Optional[str]
    agent_id_hex: str


@dataclass(frozen=True)
class ReputationSnapshot:
    cluster: str
    agent_did_hex: str
    agent_address: str
    operator: str
    jobs_completed: str
    jobs_disputed: int
    reputation: Dict[str, int]
    capability_bit_filter: Optional[int]
    category_scoped: bool


@dataclass(frozen=True)
class BidResult(TransactionEnvelope):
    nonce_hex: str
    amount_usdc_micro: int
    agent_did_hex: str
    task_id_hex: str
    warning: Optional[str]


@dataclass(frozen=True)
class RevealResult(TransactionEnvelope):
    task_id_hex: str


@dataclass(frozen=True)
class SubmitResultReceipt(TransactionEnvelope):
    agent_did_hex: str


@dataclass(frozen=True)
class ClaimPayoutResult(TransactionEnvelope):
    task_address: str
    task_id_hex: str
    payment_mint: str
    payment_amount: str
    agent_account_address: str
    agent_token_account: str
    fee_collector_token_account: str
    solrep_pool_token_account: str


@dataclass(frozen=True)
class WithdrawEarningsResult(TransactionEnvelope):
    stream_address: str
    agent_did_hex: str
    payer_mint: str
    payout_mint: str
    swapped: bool


def page_from_dict(data: Dict[str, Any], item_parser) -> Page[T]:
    return Page(
        items=[item_parser(item) for item in data.get("items", [])],
        page=int(data.get("page", 1)),
        limit=int(data.get("limit", 0)),
        total=int(data.get("total", 0)),
    )


def agent_summary_from_dict(data: Dict[str, Any]) -> AgentSummary:
    return AgentSummary(
        did=str(data["did"]),
        operator=_optional_str(data.get("operator")),
        capability_mask=_optional_str(data.get("capability_mask")),
        stake_lamports=_optional_str(data.get("stake_lamports")),
        reputation=int(data.get("reputation", 0)),
        status=str(data.get("status", "unknown")),
        last_active_unix=int(data.get("last_active_unix", 0)),
    )


def agent_detail_from_dict(data: Dict[str, Any]) -> AgentDetail:
    breakdown = [
        AgentReputationBreakdown(
            capability_bit=int(item.get("capability_bit", 0)),
            quality=int(item.get("quality", 0)),
            timeliness=int(item.get("timeliness", 0)),
            availability=int(item.get("availability", 0)),
            cost_efficiency=int(item.get("cost_efficiency", 0)),
            honesty=int(item.get("honesty", 0)),
            jobs_completed=int(item.get("jobs_completed", 0)),
            jobs_disputed=int(item.get("jobs_disputed", 0)),
            composite_score=int(item.get("composite_score", 0)),
            last_update_unix=int(item.get("last_update_unix", 0)),
        )
        for item in data.get("reputation_breakdown", [])
    ]
    return AgentDetail(
        did=str(data["did"]),
        operator=_optional_str(data.get("operator")),
        capability_mask=_optional_str(data.get("capability_mask")),
        stake_lamports=_optional_str(data.get("stake_lamports")),
        reputation_composite=int(data.get("reputation_composite", 0)),
        status=str(data.get("status", "unknown")),
        last_active_unix=int(data.get("last_active_unix", 0)),
        reputation_breakdown=breakdown,
    )


def task_summary_from_dict(data: Dict[str, Any]) -> TaskSummary:
    return TaskSummary(
        task_id_hex=str(data["task_id_hex"]),
        creator=_optional_str(data.get("creator")),
        agent_did_hex=_optional_str(data.get("agent_did_hex")),
        status=_optional_str(data.get("status")),
        reward_lamports=_optional_str(data.get("reward_lamports")),
        capability_mask=_optional_str(data.get("capability_mask")),
        created_at_unix=int(data.get("created_at_unix", 0)),
        deadline_unix=_optional_int(data.get("deadline_unix")),
        updated_at_unix=_optional_int(data.get("updated_at_unix")),
    )


def stats_from_dict(data: Dict[str, Any]) -> ProtocolStats:
    burn_rate = data.get("burn_rate", {})
    return ProtocolStats(
        total_agents=int(data.get("total_agents", 0)),
        total_tasks=int(data.get("total_tasks", 0)),
        total_value_locked_lamports=str(data.get("total_value_locked_lamports", "0")),
        active_streams=int(data.get("active_streams", 0)),
        burn_rate={
            "total_protocol_fees_lamports": str(burn_rate.get("total_protocol_fees_lamports", "0")),
            "last_24h_lamports": str(burn_rate.get("last_24h_lamports", "0")),
        },
    )


def agent_registration_from_dict(data: Dict[str, Any]) -> AgentRegistrationResult:
    tx = _transaction_fields(data)
    return AgentRegistrationResult(
        **tx,
        agent_address=_optional_str(data.get("agent_address")),
        agent_did_hex=_optional_str(data.get("agent_did_hex")),
        agent_id_hex=str(data["agent_id_hex"]),
    )


def reputation_snapshot_from_dict(data: Dict[str, Any]) -> ReputationSnapshot:
    reputation = data.get("reputation", {})
    return ReputationSnapshot(
        cluster=str(data.get("cluster", "unknown")),
        agent_did_hex=str(data["agent_did_hex"]),
        agent_address=str(data["agent_address"]),
        operator=str(data["operator"]),
        jobs_completed=str(data.get("jobs_completed", "0")),
        jobs_disputed=int(data.get("jobs_disputed", 0)),
        reputation={str(key): int(value) for key, value in reputation.items()},
        capability_bit_filter=_optional_int(data.get("capability_bit_filter")),
        category_scoped=bool(data.get("category_scoped", False)),
    )


def bid_result_from_dict(data: Dict[str, Any]) -> BidResult:
    tx = _transaction_fields(data)
    return BidResult(
        **tx,
        nonce_hex=str(data["nonce_hex"]),
        amount_usdc_micro=int(data["amount_usdc_micro"]),
        agent_did_hex=str(data["agent_did_hex"]),
        task_id_hex=str(data["task_id_hex"]),
        warning=_optional_str(data.get("warning")),
    )


def reveal_result_from_dict(data: Dict[str, Any]) -> RevealResult:
    tx = _transaction_fields(data)
    return RevealResult(**tx, task_id_hex=str(data["task_id_hex"]))


def submit_result_from_dict(data: Dict[str, Any]) -> SubmitResultReceipt:
    tx = _transaction_fields(data)
    return SubmitResultReceipt(**tx, agent_did_hex=str(data["agent_did_hex"]))


def claim_payout_from_dict(data: Dict[str, Any]) -> ClaimPayoutResult:
    tx = _transaction_fields(data)
    return ClaimPayoutResult(
        **tx,
        task_address=str(data["task_address"]),
        task_id_hex=str(data["task_id_hex"]),
        payment_mint=str(data["payment_mint"]),
        payment_amount=str(data["payment_amount"]),
        agent_account_address=str(data["agent_account_address"]),
        agent_token_account=str(data["agent_token_account"]),
        fee_collector_token_account=str(data["fee_collector_token_account"]),
        solrep_pool_token_account=str(data["solrep_pool_token_account"]),
    )


def withdraw_earnings_from_dict(data: Dict[str, Any]) -> WithdrawEarningsResult:
    tx = _transaction_fields(data)
    return WithdrawEarningsResult(
        **tx,
        stream_address=str(data["stream_address"]),
        agent_did_hex=str(data["agent_did_hex"]),
        payer_mint=str(data["payer_mint"]),
        payout_mint=str(data["payout_mint"]),
        swapped=bool(data["swapped"]),
    )


def _optional_str(value: Any) -> Optional[str]:
    if value is None:
        return None
    return str(value)


def _optional_int(value: Any) -> Optional[int]:
    if value is None:
        return None
    return int(value)


def _transaction_fields(data: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "cluster": str(data.get("cluster", "unknown")),
        "signed": bool(data.get("signed", False)),
        "signature": _optional_str(data.get("signature")),
        "unsigned_tx_base64": _optional_str(data.get("unsigned_tx_base64")),
        "last_valid_block_height": _optional_int(data.get("last_valid_block_height")),
        "auto_sign_rejected": _optional_str(data.get("auto_sign_rejected")),
    }
