"""FastAPI app: static assets, REST APIs, websocket hub, warm cellpose model."""

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket
from fastapi.staticfiles import StaticFiles
from starlette.responses import Response

from scientifica import config
from scientifica.analysis import segment, store
from scientifica.server import api_compute, api_explore, api_game, db
from scientifica.server.ws import ws_endpoint

FRONTEND_DIST = config.PROJECT_ROOT / "frontend" / "dist"


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init()
    # fail fast if the whole-well store or its ROI table is missing
    store.roi_boxes(store.open_container())
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



class DerivedStaticFiles(StaticFiles):
    """Static mount for data/derived. Nothing here is immutable: a pipeline
    re-run rewrites chunks under the same URLs, so every file revalidates
    (ETag/Last-Modified -> 304), which is cheap on a LAN."""

    def file_response(self, full_path, stat_result, scope, status_code=200) -> Response:
        response = super().file_response(full_path, stat_result, scope, status_code)
        name = Path(str(full_path)).name
        del name
        response.headers["Cache-Control"] = "no-cache"
        return response


config.DERIVED_DIR.mkdir(parents=True, exist_ok=True)
# the whole-well OME-Zarr is served straight from data/source (mount order matters:
# Starlette matches the first prefix, so /assets/source must precede /assets)
app.mount("/assets/source", DerivedStaticFiles(directory=config.SOURCE_DIR), name="source")
app.mount("/assets", DerivedStaticFiles(directory=config.DERIVED_DIR), name="assets")

if FRONTEND_DIST.exists():  # production: serve the built frontend with SPA fallback
    from fastapi.responses import FileResponse

    app.mount("/app", StaticFiles(directory=FRONTEND_DIST / "app"), name="frontend-assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        candidate = FRONTEND_DIST / path
        if path and candidate.is_file():
            return FileResponse(candidate)
        # never cache the shell: a TV holding a stale index.html would keep
        # running an old bundle across deploys
        return FileResponse(
            FRONTEND_DIST / "index.html",
            headers={"Cache-Control": "no-store"},
        )


def run() -> None:
    import uvicorn

    uvicorn.run("scientifica.server.main:app", host="0.0.0.0", port=8100)


if __name__ == "__main__":
    run()
