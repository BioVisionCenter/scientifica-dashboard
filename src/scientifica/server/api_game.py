"""Game endpoints: round control (image + stopwatch on the TV), entries CRUD, scoring, reveal broadcast."""

import json
import time
import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from scientifica import config
from scientifica.server import db, runtime_config, scoring
from scientifica.server.ws import hub

router = APIRouter(prefix="/api/game")


# One round at a time, in-memory like the TV scene state. A round is a full
# ROI image ("roi_NN") counted from the TV, or "custom" (counted elsewhere,
# true count typed by the operator).
_ROUND_IDLE = {
    "round_id": None,
    "image_id": None,
    "image_url": None,
    "status": "idle",  # idle | armed | running | stopped
    "started_at": None,  # server clock while running
    "elapsed": None,  # authoritative seconds once stopped
}
_round = dict(_ROUND_IDLE)


def _public_round() -> dict:
    out = {k: v for k, v in _round.items() if k != "started_at"}
    if _round["status"] == "running":
        out["elapsed_now"] = round(time.time() - _round["started_at"], 1)
    else:
        out["elapsed_now"] = _round["elapsed"]
    return out


def _manifest_images() -> dict[str, dict]:
    if not config.MANIFEST_PATH.exists():
        return {}
    with open(config.MANIFEST_PATH) as f:
        return {img["id"]: img for img in json.load(f)["images"]}


def _true_count_for(image_id: str) -> int | None:
    override = runtime_config.truth_override(image_id)
    if override is not None:
        return override
    img = _manifest_images().get(image_id)
    return img["cell_count"] if img else None


async def _broadcast_round() -> None:
    await hub.broadcast("round:update", _public_round())


def _public_entry(row: dict) -> dict:
    return {k: row[k] for k in ("id", "name", "game_image_id", "guess", "time_seconds", "score", "rank", "created_at") if k in row}


@router.get("/round")
def get_round():
    """Resync path; never exposes the true count."""
    return _public_round()


class RoundBody(BaseModel):
    image_id: str


@router.post("/round")
async def set_round(body: RoundBody):
    image_url = None
    if body.image_id != "custom":
        img = _manifest_images().get(body.image_id)
        if img is None:
            raise HTTPException(404, "unknown image")
        image_url = img["assets"]["enhanced"]
    _round.update(
        round_id=uuid.uuid4().hex[:8],
        image_id=body.image_id,
        image_url=image_url,
        status="armed",
        started_at=None,
        elapsed=None,
    )
    from scientifica.server import api_explore

    await api_explore.force_scene("game")
    await _broadcast_round()
    return _public_round()


@router.post("/round/start")
async def start_round():
    if _round["status"] not in ("armed", "stopped"):
        raise HTTPException(409, "no round to start")
    _round.update(status="running", started_at=time.time(), elapsed=None)
    await _broadcast_round()
    return _public_round()


@router.post("/round/stop")
async def stop_round():
    if _round["status"] != "running":
        raise HTTPException(409, "round is not running")
    _round.update(status="stopped", elapsed=round(time.time() - _round["started_at"], 1), started_at=None)
    await _broadcast_round()
    return _public_round()


@router.post("/round/clear")
async def clear_round():
    _round.update(_ROUND_IDLE)
    await _broadcast_round()
    return _public_round()


@router.get("/entries")
def list_entries(limit: int | None = None):
    return [_public_entry(r) for r in db.ranked_entries(limit)]


class NewEntry(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    game_image_id: str
    guess: int = Field(ge=0)
    time_seconds: float = Field(gt=0)
    # for custom rounds (counted outside the manifest images)
    true_count: int | None = Field(default=None, gt=0)


@router.post("/entries")
async def create_entry(body: NewEntry):
    if body.game_image_id == "custom":
        if body.true_count is None:
            raise HTTPException(422, "custom rounds need a true_count")
        true_count = body.true_count
    else:
        true_count = _true_count_for(body.game_image_id)
        if true_count is None:
            raise HTTPException(404, "unknown game image")
    score = scoring.compute_score(body.guess, true_count, body.time_seconds)
    entry = db.add_entry(body.name.strip(), body.game_image_id, body.guess, body.time_seconds, score, true_count)
    rank, total = db.rank_of(entry["id"])
    entry["rank"] = rank

    # the reveal must play on the leaderboard: move the TV there server-side
    from scientifica.server import api_explore

    if api_explore._tv_state["scene"] != "leaderboard":
        await api_explore.force_scene("leaderboard")

    await hub.broadcast(
        "entry:reveal",
        {
            "entry": _public_entry(entry),
            "rank": rank,
            "total": total,
            "true_count": true_count,
            "guess": body.guess,
        },
    )
    await hub.broadcast("leaderboard:update", {"entries": [_public_entry(r) for r in db.ranked_entries(20)]})
    return {"entry": _public_entry(entry), "rank": rank, "total": total, "true_count": true_count}


@router.delete("/entries/{entry_id}")
async def remove_entry(entry_id: int):
    if not db.delete_entry(entry_id):
        raise HTTPException(404, "no such entry")
    await hub.broadcast("leaderboard:update", {"entries": [_public_entry(r) for r in db.ranked_entries(20)]})
    return {"ok": True}
