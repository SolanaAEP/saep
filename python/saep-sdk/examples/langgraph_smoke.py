import asyncio

from saep_sdk import SAEPClient
from saep_sdk.adapters.langgraph import build_toolkit


async def main() -> None:
    client = SAEPClient("http://127.0.0.1:8790")
    toolkit = build_toolkit(client)
    tasks_tool = next(tool for tool in toolkit if tool.name == "saep_list_tasks")
    result = await tasks_tool.coroutine(limit=3)
    print(result)


if __name__ == "__main__":
    asyncio.run(main())
