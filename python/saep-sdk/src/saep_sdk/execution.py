from __future__ import annotations

import asyncio
import json
import os
import shlex
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Mapping, Optional, Protocol, Sequence


class AsyncExecutor(Protocol):
    async def call_tool(self, name: str, arguments: Optional[Mapping[str, Any]] = None) -> Dict[str, Any]:
        ...

    async def aclose(self) -> None:
        ...


@dataclass
class ExecutionError(Exception):
    message: str
    tool_name: Optional[str] = None
    details: Optional[str] = None

    def __str__(self) -> str:
        prefix = f"{self.tool_name}: " if self.tool_name else ""
        if self.details:
            return f"{prefix}{self.message} ({self.details})"
        return f"{prefix}{self.message}"


class MCPBridgeExecutor:
    def __init__(
        self,
        command: Optional[Sequence[str]] = None,
        *,
        env: Optional[Mapping[str, str]] = None,
        cwd: Optional[str] = None,
        client_name: str = "saep-sdk",
        client_version: str = "0.1.0",
        request_timeout_seconds: float = 20.0,
    ) -> None:
        resolved_command = tuple(command or _default_bridge_command())
        if not resolved_command:
            raise ExecutionError("MCP bridge command must not be empty")
        if request_timeout_seconds <= 0:
            raise ExecutionError("MCP bridge timeout must be greater than zero")
        self._command = resolved_command
        self._env = dict(env or {})
        self._cwd = cwd
        self._client_name = client_name
        self._client_version = client_version
        self._request_timeout_seconds = request_timeout_seconds
        self._process: Optional[asyncio.subprocess.Process] = None
        self._reader_task: Optional[asyncio.Task[None]] = None
        self._stderr_task: Optional[asyncio.Task[None]] = None
        self._pending: Dict[int, asyncio.Future[Any]] = {}
        self._next_id = 0
        self._start_lock = asyncio.Lock()

    async def call_tool(
        self,
        name: str,
        arguments: Optional[Mapping[str, Any]] = None,
    ) -> Dict[str, Any]:
        await self._ensure_started()
        try:
            result = await asyncio.wait_for(
                self._request(
                    "tools/call",
                    {
                        "name": name,
                        "arguments": dict(arguments or {}),
                    },
                ),
                timeout=self._request_timeout_seconds,
            )
        except asyncio.TimeoutError as exc:
            await self.aclose()
            raise ExecutionError(
                "MCP bridge call timed out",
                tool_name=name,
                details=(
                    f"after {self._request_timeout_seconds:g}s; "
                    "check SAEP_RPC_URL, SAEP_CLUSTER, and bridge operator config"
                ),
            ) from exc
        if result.get("isError"):
            raise ExecutionError(_response_text(result) or "tool call failed", tool_name=name)

        payload_text = _response_text(result)
        if not payload_text:
            return {}
        try:
            parsed = json.loads(payload_text)
        except json.JSONDecodeError as exc:
            raise ExecutionError("tool response was not valid JSON", tool_name=name, details=payload_text) from exc
        if not isinstance(parsed, dict):
            raise ExecutionError("tool response must be a JSON object", tool_name=name, details=payload_text)
        if parsed.get("error"):
            raise ExecutionError(
                str(parsed["error"]),
                tool_name=name,
                details=str(parsed.get("reason") or parsed.get("note") or ""),
            )
        return parsed

    async def aclose(self) -> None:
        process = self._process
        self._process = None
        if process is None:
            return

        if process.returncode is None:
            process.terminate()
            try:
                await asyncio.wait_for(process.wait(), timeout=2.0)
            except asyncio.TimeoutError:
                process.kill()
                await process.wait()

        self._fail_pending(ExecutionError("MCP bridge closed"))
        for task in (self._reader_task, self._stderr_task):
            if task is not None:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
                except Exception:
                    pass
        self._reader_task = None
        self._stderr_task = None

    async def _ensure_started(self) -> None:
        async with self._start_lock:
            if self._process is not None:
                return

            env = os.environ.copy()
            env.update(self._env)
            self._process = await asyncio.create_subprocess_exec(
                *self._command,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=self._cwd,
                env=env,
            )
            self._reader_task = asyncio.create_task(self._reader_loop())
            self._stderr_task = asyncio.create_task(self._drain_stderr())
            try:
                await asyncio.wait_for(
                    self._request(
                        "initialize",
                        {
                            "protocolVersion": "2025-06-18",
                            "capabilities": {},
                            "clientInfo": {
                                "name": self._client_name,
                                "version": self._client_version,
                            },
                        },
                    ),
                    timeout=self._request_timeout_seconds,
                )
                await self._notify("notifications/initialized")
            except asyncio.TimeoutError as exc:
                await self.aclose()
                raise ExecutionError(
                    "MCP bridge initialization timed out",
                    details=(
                        f"after {self._request_timeout_seconds:g}s; "
                        "verify the bridge command launches a compatible server"
                    ),
                ) from exc
            except Exception:
                await self.aclose()
                raise

    async def _request(self, method: str, params: Optional[Mapping[str, Any]] = None) -> Dict[str, Any]:
        process = self._process
        if process is None or process.stdin is None:
            raise ExecutionError("MCP bridge process is not running")

        self._next_id += 1
        request_id = self._next_id
        loop = asyncio.get_running_loop()
        future: asyncio.Future[Any] = loop.create_future()
        self._pending[request_id] = future

        await self._send_message(
            {
                "jsonrpc": "2.0",
                "id": request_id,
                "method": method,
                "params": dict(params or {}),
            }
        )
        response = await future
        if not isinstance(response, dict):
            raise ExecutionError("MCP bridge returned a non-object response", details=str(response))
        return response

    async def _notify(self, method: str, params: Optional[Mapping[str, Any]] = None) -> None:
        await self._send_message(
            {
                "jsonrpc": "2.0",
                "method": method,
                "params": dict(params or {}),
            }
        )

    async def _send_message(self, message: Mapping[str, Any]) -> None:
        process = self._process
        if process is None or process.stdin is None:
            raise ExecutionError("MCP bridge process is not running")
        payload = (json.dumps(message) + "\n").encode("utf-8")
        process.stdin.write(payload)
        await process.stdin.drain()

    async def _reader_loop(self) -> None:
        try:
            while True:
                message = await self._read_message()
                if message is None:
                    raise ExecutionError("MCP bridge closed its stdout pipe")
                if "id" not in message:
                    continue
                future = self._pending.pop(int(message["id"]), None)
                if future is None or future.done():
                    continue
                if "error" in message:
                    error = message["error"]
                    future.set_exception(
                        ExecutionError(
                            str(error.get("message", "JSON-RPC error")),
                            details=json.dumps(error),
                        )
                    )
                else:
                    future.set_result(message.get("result", {}))
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            self._fail_pending(exc)

    async def _read_message(self) -> Optional[Dict[str, Any]]:
        process = self._process
        if process is None or process.stdout is None:
            return None

        while True:
            line = await process.stdout.readline()
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
                    header_line = await process.stdout.readline()
                    if not header_line:
                        return None
                    header_text = header_line.decode("utf-8").strip()
                    if not header_text:
                        break
                    header_name, _, header_value = header_text.partition(":")
                    headers[header_name.lower()] = header_value.strip()
                length = headers.get("content-length")
                if length is None:
                    raise ExecutionError("MCP bridge response missing Content-Length header")
                body = await process.stdout.readexactly(int(length))
                message = json.loads(body.decode("utf-8"))
            else:
                message = json.loads(decoded)
            break

        if not isinstance(message, dict):
            raise ExecutionError("MCP bridge response must be a JSON object")
        return message

    async def _drain_stderr(self) -> None:
        process = self._process
        if process is None or process.stderr is None:
            return
        try:
            while True:
                line = await process.stderr.readline()
                if not line:
                    return
        except asyncio.CancelledError:
            raise

    def _fail_pending(self, exc: Exception) -> None:
        for future in list(self._pending.values()):
            if not future.done():
                future.set_exception(exc)
        self._pending.clear()


def _default_bridge_command() -> Sequence[str]:
    from_env = os.environ.get("SAEP_MCP_BRIDGE_COMMAND")
    if from_env:
        return tuple(shlex.split(from_env))

    for parent in Path(__file__).resolve().parents:
        candidate = parent / "services" / "mcp-bridge" / "dist" / "server.js"
        if candidate.exists():
            return ("node", str(candidate))

    raise ExecutionError(
        "Could not locate services/mcp-bridge/dist/server.js. "
        "Pass an explicit MCP bridge command or set SAEP_MCP_BRIDGE_COMMAND."
    )


def _response_text(result: Mapping[str, Any]) -> str:
    content = result.get("content")
    if not isinstance(content, list):
        return ""
    for item in content:
        if isinstance(item, dict) and item.get("type") == "text":
            text = item.get("text")
            if text is not None:
                return str(text)
    return ""
