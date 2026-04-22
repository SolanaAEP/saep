import asyncio
import json
import unittest
from unittest.mock import patch

from saep_sdk import SAEPClient

from hermes_saep_plugin import TOOLSET_NAME, load_config, register, register_with_client


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


class FakeContext:
    def __init__(self):
        self.tools = []

    def register_tool(self, name, toolset, schema, handler, **kwargs):
        self.tools.append(
            {
                "name": name,
                "toolset": toolset,
                "schema": schema,
                "handler": handler,
                "kwargs": kwargs,
            }
        )


class HermesPluginTests(unittest.TestCase):
    def test_load_config_defaults_to_read_only(self):
        config = load_config({})
        self.assertEqual(config.discovery_url, "https://buildonsaep.com/api/discovery/v1/discovery")
        self.assertFalse(config.has_execution_backend)

    def test_load_config_parses_bridge_env(self):
        config = load_config(
            {
                "SAEP_DISCOVERY_URL": "https://discovery.example",
                "SAEP_MCP_BRIDGE_COMMAND_JSON": '["node","bridge.js"]',
                "SAEP_MCP_BRIDGE_ENV_JSON": '{"SAEP_CLUSTER":"devnet","SAEP_AUTO_SIGN":true}',
                "SAEP_MCP_BRIDGE_TIMEOUT_SECONDS": "45",
            }
        )
        self.assertEqual(config.discovery_url, "https://discovery.example")
        self.assertEqual(config.bridge_command, ("node", "bridge.js"))
        self.assertEqual(config.bridge_env, {"SAEP_CLUSTER": "devnet", "SAEP_AUTO_SIGN": "true"})
        self.assertEqual(config.bridge_timeout_seconds, 45.0)

    def test_register_read_only_mode_uses_env_defaults(self):
        ctx = FakeContext()
        with patch.dict("os.environ", {"SAEP_DISCOVERY_URL": "https://discovery.example"}, clear=True):
            register(ctx)

        self.assertEqual([tool["name"] for tool in ctx.tools], ["saep_list_tasks", "saep_get_agent", "saep_get_stats"])
        self.assertTrue(all(tool["toolset"] == TOOLSET_NAME for tool in ctx.tools))
        self.assertTrue(all(tool["kwargs"].get("is_async") for tool in ctx.tools))

    def test_register_with_execution_backend_adds_write_tools(self):
        ctx = FakeContext()
        client = SAEPClient("http://unused", transport=FakeTransport(), executor=FakeExecutor())
        register_with_client(ctx, client)

        names = [tool["name"] for tool in ctx.tools]
        self.assertIn("saep_register_agent", names)
        self.assertEqual(len(names), 10)

    def test_read_tool_handler_returns_json_string(self):
        ctx = FakeContext()
        client = SAEPClient("http://unused", transport=FakeTransport())
        register_with_client(ctx, client)

        list_tasks_tool = next(tool for tool in ctx.tools if tool["name"] == "saep_list_tasks")
        result = asyncio.run(list_tasks_tool["handler"]({"limit": 1}))

        payload = json.loads(result)
        self.assertEqual(payload["total"], 1)
        self.assertEqual(payload["items"][0]["status"], "funded")

    def test_write_tool_handler_routes_through_executor(self):
        ctx = FakeContext()
        client = SAEPClient("http://unused", transport=FakeTransport(), executor=FakeExecutor())
        register_with_client(ctx, client)

        register_tool = next(tool for tool in ctx.tools if tool["name"] == "saep_register_agent")
        result = asyncio.run(
            register_tool["handler"](
                {
                    "capability_bits": [2],
                    "metadata_uri": "https://example.com/agent.json",
                    "stake_mint": "stake-mint",
                    "operator_token_account": "operator-token-account",
                }
            )
        )

        payload = json.loads(result)
        self.assertEqual(payload["signature"], "sig-1")
        self.assertEqual(payload["agent_address"], "agent-1")


if __name__ == "__main__":
    unittest.main()
