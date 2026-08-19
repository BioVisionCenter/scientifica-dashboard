"""WebSocket hub: TV and admin clients subscribe; REST handlers broadcast."""

import asyncio
import json
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect


class Hub:
    def __init__(self) -> None:
        self._clients: dict[WebSocket, str] = {}
        self._lock = asyncio.Lock()

    async def register(self, ws: WebSocket, role: str) -> None:
        await ws.accept()
        async with self._lock:
            self._clients[ws] = role

    async def unregister(self, ws: WebSocket) -> None:
        async with self._lock:
            self._clients.pop(ws, None)

    async def broadcast(self, type_: str, payload: Any) -> None:
        msg = json.dumps({"type": type_, "payload": payload})
        async with self._lock:
            targets = list(self._clients)
        for ws in targets:
            try:
                await ws.send_text(msg)
            except Exception:
                await self.unregister(ws)


hub = Hub()


async def ws_endpoint(ws: WebSocket, role: str = "tv") -> None:
    await hub.register(ws, role)
    try:
        while True:
            await ws.receive_text()  # clients only send hello/pings; content ignored
    except WebSocketDisconnect:
        await hub.unregister(ws)
