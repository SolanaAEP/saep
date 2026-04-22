import asyncio
import unittest

from saep_sdk import SAEPClient
from saep_sdk.execution import ExecutionError
from saep_sdk.transport import TransportError
from saep_sdk.wallet import CallbackWallet


class FakeTransport:
    def __init__(self, responses):
        self._responses = responses
        self.calls = []

    async def request(self, method, path, *, params=None, json_body=None, headers=None):
        self.calls.append(
            {
                "method": method,
                "path": path,
                "params": params or {},
                "json_body": json_body,
                "headers": headers or {},
            }
        )
        response = self._responses[path]
        if isinstance(response, Exception):
            raise response
        return response


class FakeExecutor:
    def __init__(self, responses):
        self._responses = responses
        self.calls = []
        self.closed = False

    async def call_tool(self, name, arguments=None):
        self.calls.append({"name": name, "arguments": arguments or {}})
        response = self._responses[name]
        if isinstance(response, Exception):
            raise response
        return response

    async def aclose(self):
        self.closed = True


class ClientTests(unittest.TestCase):
    def test_list_tasks_parses_page(self):
        transport = FakeTransport(
            {
                "/tasks": {
                    "items": [
                        {
                            "task_id_hex": "ab" * 32,
                            "creator": "creator-1",
                            "agent_did_hex": None,
                            "status": "funded",
                            "reward_lamports": "1000",
                            "capability_mask": "8",
                            "created_at_unix": 10,
                            "deadline_unix": 20,
                            "updated_at_unix": 11,
                        }
                    ],
                    "page": 2,
                    "limit": 5,
                    "total": 9,
                }
            }
        )
        client = SAEPClient("http://unused", transport=transport)

        page = asyncio.run(client.list_tasks(capability=3, page=2, limit=5))

        self.assertEqual(page.page, 2)
        self.assertEqual(page.total, 9)
        self.assertEqual(page.items[0].status, "funded")
        self.assertEqual(transport.calls[0]["params"]["capability"], 3)

    def test_get_agent_parses_reputation_breakdown(self):
        did = "cd" * 32
        transport = FakeTransport(
            {
                f"/agents/{did}": {
                    "did": did,
                    "operator": "operator-1",
                    "capability_mask": "4",
                    "stake_lamports": "999",
                    "reputation_composite": 8800,
                    "status": "active",
                    "last_active_unix": 55,
                    "reputation_breakdown": [
                        {
                            "capability_bit": 2,
                            "quality": 9000,
                            "timeliness": 9100,
                            "availability": 9200,
                            "cost_efficiency": 9300,
                            "honesty": 9400,
                            "jobs_completed": 12,
                            "jobs_disputed": 1,
                            "composite_score": 9200,
                            "last_update_unix": 44,
                        }
                    ],
                }
            }
        )
        client = SAEPClient("http://unused", transport=transport)

        detail = asyncio.run(client.get_agent(did))

        self.assertEqual(detail.did, did)
        self.assertEqual(detail.reputation_breakdown[0].capability_bit, 2)
        self.assertEqual(detail.reputation_breakdown[0].composite_score, 9200)

    def test_transport_errors_bubble(self):
        transport = FakeTransport({"/stats": TransportError("boom", status_code=503)})
        client = SAEPClient("http://unused", transport=transport)

        with self.assertRaises(TransportError):
            asyncio.run(client.get_stats())

    def test_callback_wallet_delegates_signing(self):
        async def signer(message: bytes) -> bytes:
            return message[::-1]

        wallet = CallbackWallet(address="wallet-1", signer=signer)
        signature = asyncio.run(wallet.sign_message(b"saep"))
        self.assertEqual(signature, b"peas")

    def test_action_methods_parse_execution_results(self):
        did = "ab" * 32
        executor = FakeExecutor(
            {
                "register_agent": {
                    "cluster": "devnet",
                    "signed": True,
                    "signature": "sig-1",
                    "agent_address": "agent-1",
                    "agent_did_hex": did,
                    "agent_id_hex": "cd" * 32,
                },
                "get_reputation": {
                    "cluster": "devnet",
                    "agent_did_hex": did,
                    "agent_address": "agent-1",
                    "operator": "operator-1",
                    "jobs_completed": "9",
                    "jobs_disputed": 1,
                    "reputation": {
                        "quality": 9000,
                        "timeliness": 8900,
                        "availability": 8800,
                        "cost_efficiency": 8700,
                        "honesty": 8600,
                        "composite": 8800,
                    },
                    "capability_bit_filter": 2,
                    "category_scoped": False,
                },
                "withdraw_earnings": {
                    "cluster": "devnet",
                    "signed": False,
                    "unsigned_tx_base64": "Zm9v",
                    "last_valid_block_height": 99,
                    "stream_address": "stream-1",
                    "agent_did_hex": did,
                    "payer_mint": "payer-1",
                    "payout_mint": "payout-1",
                    "swapped": False,
                },
            }
        )
        client = SAEPClient("http://unused", transport=FakeTransport({"/stats": {}}), executor=executor)

        registration = asyncio.run(
            client.register_agent(
                capability_bits=[2],
                metadata_uri="https://example.com/agent.json",
                stake_mint="stake-mint",
                operator_token_account="operator-token-account",
            )
        )
        reputation = asyncio.run(client.get_reputation(did, capability_bit=2))
        withdrawal = asyncio.run(client.withdraw_earnings(stream_address="stream-1"))
        asyncio.run(client.aclose())

        self.assertTrue(client.has_execution_backend)
        self.assertEqual(registration.agent_did_hex, did)
        self.assertEqual(reputation.reputation["quality"], 9000)
        self.assertEqual(withdrawal.last_valid_block_height, 99)
        self.assertEqual(executor.calls[0]["name"], "register_agent")
        self.assertEqual(executor.calls[1]["arguments"]["capability_bit"], 2)
        self.assertTrue(executor.closed)

    def test_action_methods_require_execution_backend(self):
        client = SAEPClient("http://unused", transport=FakeTransport({"/stats": {}}))

        with self.assertRaises(ExecutionError):
            asyncio.run(client.claim_payout(task_address="task-1"))


if __name__ == "__main__":
    unittest.main()
