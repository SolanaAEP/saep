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
                        "serverInfo": {"name": "fake-mcp-bridge-hanging", "version": "0.1.0"},
                    },
                }
            )
            continue

        if message.get("method") == "notifications/initialized":
            continue

        if message.get("method") == "tools/call":
            continue

        send(
            {
                "jsonrpc": "2.0",
                "id": message["id"],
                "error": {"code": -32601, "message": f"unknown method: {message.get('method')}"},
            }
        )


if __name__ == "__main__":
    raise SystemExit(main())
