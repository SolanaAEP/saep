import asyncio
import unittest

from saep_sdk import SAEPClient
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


if __name__ == "__main__":
    unittest.main()
