from __future__ import annotations

from dataclasses import dataclass
from typing import Awaitable, Callable, Protocol


class Wallet(Protocol):
    address: str

    async def sign_message(self, message: bytes) -> bytes:
        ...


SignerCallback = Callable[[bytes], Awaitable[bytes]]


@dataclass(frozen=True)
class CallbackWallet:
    address: str
    signer: SignerCallback

    async def sign_message(self, message: bytes) -> bytes:
        return await self.signer(message)
