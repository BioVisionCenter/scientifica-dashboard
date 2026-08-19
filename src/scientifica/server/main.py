"""FastAPI app: static assets, REST APIs, websocket hub, warm cellpose model."""

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket
from fastapi.staticfiles import StaticFiles

from scientifica import config
from scientifica.analysis import segment
from scientifica.server import api_compute, api_explore, api_game, db
from scientifica.server.ws import ws_endpoint

FRONTEND_DIST = config.PROJECT_ROOT / "frontend" / "dist"


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init()
    # Warm the cellpose model off the event loop so the first live re-run is fast
    asyncio.get_event_loop().run_in_executor(None, segment.warmup)
    yield


app = FastAPI(title="Scientifica Dashboard", lifespan=lifespan)

app.include_router(api_explore.router)
app.include_router(api_game.router)
app.include_router(api_compute.router)


@app.websocket("/ws")
async def ws(websocket: WebSocket, role: str = "tv"):
    await ws_endpoint(websocket, role)


config.DERIVED_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/assets", StaticFiles(directory=config.DERIVED_DIR), name="assets")

if FRONTEND_DIST.exists():  # production: serve the built frontend with SPA fallback
    from fastapi.responses import FileResponse

    app.mount("/app", StaticFiles(directory=FRONTEND_DIST / "app"), name="frontend-assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        candidate = FRONTEND_DIST / path
        if path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")


def run() -> None:
    import uvicorn

    uvicorn.run("scientifica.server.main:app", host="0.0.0.0", port=8100)


if __name__ == "__main__":
    run()
