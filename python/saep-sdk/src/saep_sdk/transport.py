from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from typing import Any, Dict, Mapping, Optional, Protocol
from urllib import error, parse, request


class AsyncTransport(Protocol):
    async def request(
        self,
        method: str,
        path: str,
        *,
        params: Optional[Mapping[str, Any]] = None,
        json_body: Optional[Mapping[str, Any]] = None,
        headers: Optional[Mapping[str, str]] = None,
    ) -> Dict[str, Any]:
        ...


@dataclass
class TransportError(Exception):
    message: str
    status_code: Optional[int] = None
    body: Optional[str] = None

    def __str__(self) -> str:
        if self.status_code is None:
            return self.message
        return f"{self.message} (status={self.status_code})"


class UrllibAsyncTransport:
    def __init__(self, base_url: str, timeout_seconds: float = 10.0) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout_seconds = timeout_seconds

    async def request(
        self,
        method: str,
        path: str,
        *,
        params: Optional[Mapping[str, Any]] = None,
        json_body: Optional[Mapping[str, Any]] = None,
        headers: Optional[Mapping[str, str]] = None,
    ) -> Dict[str, Any]:
        return await asyncio.to_thread(
            self._request_sync,
            method,
            path,
            params or {},
            json_body,
            headers or {},
        )

    def _request_sync(
        self,
        method: str,
        path: str,
        params: Mapping[str, Any],
        json_body: Optional[Mapping[str, Any]],
        headers: Mapping[str, str],
    ) -> Dict[str, Any]:
        url = f"{self._base_url}/{path.lstrip('/')}"
        if params:
            url = f"{url}?{parse.urlencode(_normalize_params(params), doseq=True)}"

        body = None
        merged_headers = {"accept": "application/json", **headers}
        if json_body is not None:
            body = json.dumps(json_body).encode("utf-8")
            merged_headers["content-type"] = "application/json"

        req = request.Request(url, method=method.upper(), data=body, headers=merged_headers)
        try:
            with request.urlopen(req, timeout=self._timeout_seconds) as response:
                payload = response.read().decode("utf-8")
                if not payload:
                    return {}
                return json.loads(payload)
        except error.HTTPError as exc:
            raw = exc.read().decode("utf-8", errors="replace")
            raise TransportError(
                message="request failed",
                status_code=exc.code,
                body=raw,
            ) from exc
        except error.URLError as exc:
            raise TransportError(message=str(exc.reason)) from exc


def _normalize_params(params: Mapping[str, Any]) -> Dict[str, Any]:
    normalized: Dict[str, Any] = {}
    for key, value in params.items():
        if value is None:
            continue
        normalized[key] = value
    return normalized
