import asyncio
import importlib
import inspect
import sys
import types
import unittest
from unittest.mock import patch

from saep_sdk import SAEPClient


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
        did = "ab" * 32
        if name == "register_agent":
            return {
                "cluster": "devnet",
                "signed": True,
                "signature": "sig-1",
                "agent_address": "agent-1",
                "agent_did_hex": did,
                "agent_id_hex": "cd" * 32,
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
        raise AssertionError(f"unexpected tool call: {name}")

    async def aclose(self):
        return None


def _fake_pydantic_modules():
    module = types.ModuleType("pydantic")

    class BaseModel:
        pass

    def Field(default=..., description=None):
        return {"default": default, "description": description}

    def create_model(name, **fields):
        return type(name, (BaseModel,), {"model_fields": fields})

    module.BaseModel = BaseModel
    module.Field = Field
    module.create_model = create_model
    return module


def _fake_crewai_modules():
    package = types.ModuleType("crewai")
    tools_module = types.ModuleType("crewai.tools")

    class BaseTool:
        pass

    tools_module.BaseTool = BaseTool
    package.tools = tools_module
    return package, tools_module


def _fake_autogen_modules():
    package = types.ModuleType("autogen_core")
    tools_module = types.ModuleType("autogen_core.tools")

    class FunctionTool:
        def __init__(self, func, description):
            self.func = func
            self.description = description
            self.schema = {
                "name": func.__name__,
                "description": description,
                "parameters": str(inspect.signature(func)),
            }

    tools_module.FunctionTool = FunctionTool
    package.tools = tools_module
    return package, tools_module


class AdapterTests(unittest.TestCase):
    def _client(self):
        return SAEPClient("http://unused", transport=FakeTransport(), executor=FakeExecutor())

    def test_crewai_adapter_builds_tools(self):
        crewai_package, crewai_tools = _fake_crewai_modules()
        fake_pydantic = _fake_pydantic_modules()
        with patch.dict(
            sys.modules,
            {
                "crewai": crewai_package,
                "crewai.tools": crewai_tools,
                "pydantic": fake_pydantic,
            },
        ):
            module = importlib.import_module("saep_sdk.adapters.crewai")
            module = importlib.reload(module)
            tools = module.build_tools(self._client())

        names = [tool.name for tool in tools]
        self.assertIn("saep_register_agent", names)
        register_tool = next(tool for tool in tools if tool.name == "saep_register_agent")
        result = asyncio.run(
            register_tool._run(
                capability_bits=[2],
                metadata_uri="https://example.com/agent.json",
                stake_mint="stake-mint",
                operator_token_account="operator-token-account",
            )
        )
        self.assertIn('"agent_address": "agent-1"', result)
        self.assertTrue(hasattr(register_tool.args_schema, "model_fields"))

    def test_autogen_adapter_builds_function_tools(self):
        autogen_package, autogen_tools = _fake_autogen_modules()
        with patch.dict(
            sys.modules,
            {
                "autogen_core": autogen_package,
                "autogen_core.tools": autogen_tools,
            },
        ):
            module = importlib.import_module("saep_sdk.adapters.autogen")
            module = importlib.reload(module)
            tools = module.build_tools(self._client())

        names = [tool.schema["name"] for tool in tools]
        self.assertIn("saep_claim_payout", names)
        claim_tool = next(tool for tool in tools if tool.schema["name"] == "saep_claim_payout")
        self.assertIn("task_address", claim_tool.schema["parameters"])
        result = asyncio.run(claim_tool.func(task_address="task-1"))
        self.assertIn('"signature": "sig-claim"', result)


if __name__ == "__main__":
    unittest.main()
