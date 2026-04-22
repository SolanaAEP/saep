import asyncio
import sys
import unittest
from pathlib import Path

from saep_sdk import MCPBridgeExecutor, SAEPClient
from saep_sdk.execution import ExecutionError


FIXTURE = Path(__file__).resolve().parent / "fixtures" / "fake_mcp_bridge.py"


class ExecutionTests(unittest.TestCase):
    def test_mcp_bridge_executor_calls_tools(self):
        async def scenario():
            executor = MCPBridgeExecutor(command=[sys.executable, str(FIXTURE)])
            try:
                result = await executor.call_tool(
                    "get_reputation",
                    {"agent_did_hex": "ab" * 32, "capability_bit": 2},
                )
                self.assertEqual(result["operator"], "operator-1")
                self.assertEqual(result["capability_bit_filter"], 2)
            finally:
                await executor.aclose()

        asyncio.run(scenario())

    def test_client_uses_mcp_bridge_for_action_methods(self):
        async def scenario():
            async with SAEPClient(
                "http://unused",
                bridge_command=[sys.executable, str(FIXTURE)],
            ) as client:
                registration = await client.register_agent(
                    capability_bits=[2],
                    metadata_uri="https://example.com/agent.json",
                    stake_mint="stake-mint",
                    operator_token_account="operator-token-account",
                )
                payout = await client.claim_payout(task_address="task-1")
                self.assertEqual(registration.last_valid_block_height, 77)
                self.assertEqual(payout.signature, "sig-claim")

        asyncio.run(scenario())

    def test_client_raises_execution_errors_from_tool_payloads(self):
        async def scenario():
            async with SAEPClient(
                "http://unused",
                bridge_command=[sys.executable, str(FIXTURE)],
            ) as client:
                with self.assertRaises(ExecutionError):
                    await client.withdraw_earnings(stream_address="stream-1")

        asyncio.run(scenario())


if __name__ == "__main__":
    unittest.main()
