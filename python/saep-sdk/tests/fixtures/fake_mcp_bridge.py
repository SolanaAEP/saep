#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from typing import Any, Dict, Optional


def read_message() -> Optional[Dict[str, Any]]:
    while True:
        line = sys.stdin.buffer.readline()
        if not line:
            return None
        decoded = line.decode("utf-8").strip()
        if not decoded:
            continue
        if decoded.lower().startswith("content-length:"):
            headers: Dict[str, str] = {}
            name, _, value = decoded.partition(":")
            headers[name.lower()] = value.strip()
            while True:
                header_line = sys.stdin.buffer.readline()
                if not header_line:
                    return None
                header_text = header_line.decode("utf-8").strip()
                if not header_text:
                    break
                header_name, _, header_value = header_text.partition(":")
                headers[header_name.lower()] = header_value.strip()

            length = headers.get("content-length")
            if length is None:
                raise RuntimeError("missing content-length")
            body = sys.stdin.buffer.read(int(length))
            return json.loads(body.decode("utf-8"))
        return json.loads(decoded)


def send(message: Dict[str, Any]) -> None:
    payload = (json.dumps(message) + "\n").encode("utf-8")
    sys.stdout.buffer.write(payload)
    sys.stdout.buffer.flush()


def tool_payload(name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
    did = "ab" * 32
    if name == "register_agent":
        return {
            "cluster": "devnet",
            "signed": False,
            "unsigned_tx_base64": "Zm9v",
            "last_valid_block_height": 77,
            "agent_address": None,
            "agent_did_hex": None,
            "agent_id_hex": "cd" * 32,
        }
    if name == "get_reputation":
        return {
            "cluster": "devnet",
            "agent_did_hex": arguments["agent_did_hex"],
            "agent_address": "agent-1",
            "operator": "operator-1",
            "jobs_completed": "4",
            "jobs_disputed": 0,
            "reputation": {
                "quality": 9100,
                "timeliness": 9200,
                "availability": 9300,
                "cost_efficiency": 9400,
                "honesty": 9500,
                "composite": 9300,
            },
            "capability_bit_filter": arguments.get("capability_bit"),
            "category_scoped": False,
        }
    if name == "claim_payout":
        return {
            "cluster": "devnet",
            "signed": True,
            "signature": "sig-claim",
            "task_address": arguments["task_address"],
            "task_id_hex": did,
            "payment_mint": "mint-1",
            "payment_amount": "1000",
            "agent_account_address": "agent-account-1",
            "agent_token_account": "agent-token-1",
            "fee_collector_token_account": "fee-token-1",
            "solrep_pool_token_account": "solrep-token-1",
        }
    if name == "withdraw_earnings":
        return {
            "error": "swap_route_required",
            "reason": "cross-mint withdrawals need route_data_base64 plus Jupiter + oracle accounts",
        }
    raise RuntimeError(f"unknown tool: {name}")


def main() -> int:
    while True:
        message = read_message()
        if message is None:
            return 0

        if message.get("method") == "initialize":
            send(
                {
                    "jsonrpc": "2.0",
                    "id": message["id"],
                    "result": {
                        "protocolVersion": "2025-06-18",
                        "capabilities": {"tools": {}},
                        "serverInfo": {"name": "fake-mcp-bridge", "version": "0.1.0"},
                    },
                }
            )
            continue

        if message.get("method") == "notifications/initialized":
            continue

        if message.get("method") == "tools/call":
            name = message["params"]["name"]
            arguments = message["params"].get("arguments", {})
            payload = tool_payload(name, arguments)
            send(
                {
                    "jsonrpc": "2.0",
                    "id": message["id"],
                    "result": {
                        "content": [
                            {
                                "type": "text",
                                "text": json.dumps(payload),
                            }
                        ]
                    },
                }
            )
            continue

        send(
            {
                "jsonrpc": "2.0",
                "id": message["id"],
                "error": {
                    "code": -32601,
                    "message": f"unknown method: {message.get('method')}",
                },
            }
        )


if __name__ == "__main__":
    raise SystemExit(main())
