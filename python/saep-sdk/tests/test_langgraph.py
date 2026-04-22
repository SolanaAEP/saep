import asyncio
import unittest

from saep_sdk import SAEPClient
from saep_sdk.adapters.langgraph import build_toolkit


class FakeTransport:
    async def request(self, method, path, *, params=None, json_body=None, headers=None):
        if path == "/tasks":
            return {
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
                "page": 1,
                "limit": 25,
                "total": 1,
            }
        if path.startswith("/agents/"):
            did = path.split("/")[-1]
            return {
                "did": did,
                "operator": "operator-1",
                "capability_mask": "4",
                "stake_lamports": "999",
                "reputation_composite": 8800,
                "status": "active",
                "last_active_unix": 55,
                "reputation_breakdown": [],
            }
        return {
            "total_agents": 2,
            "total_tasks": 3,
            "total_value_locked_lamports": "77",
            "active_streams": 1,
            "burn_rate": {
                "total_protocol_fees_lamports": "7",
                "last_24h_lamports": "2",
            },
        }


class FakeExecutor:
    async def call_tool(self, name, arguments=None):
        if name == "register_agent":
            return {
                "cluster": "devnet",
                "signed": True,
                "signature": "sig-1",
                "agent_address": "agent-1",
                "agent_did_hex": "ab" * 32,
                "agent_id_hex": "cd" * 32,
            }
        raise AssertionError(f"unexpected tool call: {name}")

    async def aclose(self):
        return None


class LangGraphToolkitTests(unittest.TestCase):
    def test_toolkit_exposes_expected_tools(self):
        client = SAEPClient("http://unused", transport=FakeTransport())
        toolkit = build_toolkit(client)
        self.assertEqual(
            [tool.name for tool in toolkit],
            ["saep_list_tasks", "saep_get_agent", "saep_get_stats"],
        )

    def test_task_tool_returns_serializable_payload(self):
        client = SAEPClient("http://unused", transport=FakeTransport())
        toolkit = build_toolkit(client)
        task_tool = toolkit[0]

        result = asyncio.run(task_tool.coroutine(limit=1))

        self.assertEqual(result["total"], 1)
        self.assertEqual(result["items"][0]["status"], "funded")

    def test_execution_backend_adds_action_tools(self):
        client = SAEPClient("http://unused", transport=FakeTransport(), executor=FakeExecutor())
        toolkit = build_toolkit(client)

        self.assertIn("saep_register_agent", [tool.name for tool in toolkit])

        register_tool = next(tool for tool in toolkit if tool.name == "saep_register_agent")
        result = asyncio.run(
            register_tool.coroutine(
                capability_bits=[2],
                metadata_uri="https://example.com/agent.json",
                stake_mint="stake-mint",
                operator_token_account="operator-token-account",
            )
        )

        self.assertEqual(result["signature"], "sig-1")
        self.assertEqual(result["agent_address"], "agent-1")


if __name__ == "__main__":
    unittest.main()
