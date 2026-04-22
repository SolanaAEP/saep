import asyncio

from saep_sdk import SAEPClient
from saep_sdk.adapters.crewai import build_tools


async def main() -> None:
    client = SAEPClient("http://127.0.0.1:8790")
    tools = build_tools(client)
    print([tool.name for tool in tools])


if __name__ == "__main__":
    asyncio.run(main())
