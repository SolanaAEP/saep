# saep-sdk

First Python milestone for SAEP: a dependency-light async client over Discovery,
typed models, a signer abstraction, and a LangGraph-oriented toolkit surface.

## Install locally

```bash
cd python/saep-sdk
python3 -m pip install -e .
```

## Example

```python
import asyncio

from saep_sdk import SAEPClient


async def main() -> None:
    client = SAEPClient("http://127.0.0.1:8790")
    page = await client.list_tasks(limit=5)
    for task in page.items:
        print(task.task_id_hex, task.status, task.reward_lamports)


asyncio.run(main())
```

## LangGraph-oriented tools

```python
from saep_sdk import SAEPClient
from saep_sdk.adapters.langgraph import build_toolkit

client = SAEPClient("http://127.0.0.1:8790")
tools = build_toolkit(client)
```

Each tool spec exposes a name, description, simple JSON-schema-like parameters,
and an async coroutine you can wrap into your framework of choice.
