"""Game endpoints: patches, entries CRUD, scoring, reveal broadcast."""

import json

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from scientifica import config
from scientifica.server import db, scoring
from scientifica.server.ws import hub

router = APIRouter(prefix="/api/game")


def _game_images() -> list[dict]:
    if not config.GAME_MANIFEST_PATH.exists():
        return []
    with open(config.GAME_MANIFEST_PATH) as f:
        return json.load(f)


def _public_entry(row: dict) -> dict:
    return {k: row[k] for k in ("id", "name", "game_image_id", "guess", "time_seconds", "score", "rank", "created_at") if k in row}


@router.get("/images")
def list_images():
    """Game patches WITHOUT ground-truth counts."""
    return [{k: v for k, v in img.items() if k != "true_count"} for img in _game_images()]


@router.get("/entries")
def list_entries(limit: int | None = None):
    return [_public_entry(r) for r in db.ranked_entries(limit)]


class NewEntry(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    game_image_id: str
    guess: int = Field(ge=0)
    time_seconds: float = Field(gt=0)


@router.post("/entries")
async def create_entry(body: NewEntry):
    images = {img["id"]: img for img in _game_images()}
    if body.game_image_id not in images:
        raise HTTPException(404, "unknown game image")
    true_count = images[body.game_image_id]["true_count"]
    score = scoring.compute_score(body.guess, true_count, body.time_seconds)
    entry = db.add_entry(body.name.strip(), body.game_image_id, body.guess, body.time_seconds, score)
    rank, total = db.rank_of(entry["id"])
    entry["rank"] = rank

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
