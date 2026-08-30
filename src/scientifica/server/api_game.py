"""Game endpoints: up to six independent lanes (player + field + stopwatch on
the TV), entries CRUD, scoring, reveal broadcast."""

import asyncio
import json
import time

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from scientifica import config
from scientifica.server import db, runtime_config, scoring
from scientifica.server.ws import hub

router = APIRouter(prefix="/api/game")

N_LANES = 6

# Lanes are in-memory like the TV scene state. A lane is one player counting
# one field: it is armed with a name + image, started (together with the
# others or alone), stopped alone, then its count is submitted, which turns
# it into a leaderboard entry. Lanes are independent: a finished lane can be
# given to the next player while the others keep running.
_LANE_STATUSES = ("empty", "armed", "running", "stopped", "done")


def _empty_lane(slot: int) -> dict:
    return {
        "slot": slot,
        "name": "",
        "image_id": None,
        "image_url": None,
        "image_title": None,
        "status": "empty",
        "run_id": 0,  # bumped on every start so clients re-seed their ticker
        "started_at": None,  # private: server clock while running
        "elapsed": None,  # authoritative seconds once stopped / done
        "true_count": None,  # private: custom lanes only
        "entry_id": None,
        "score": None,
        "rank": None,
    }


_lanes: list[dict] = [_empty_lane(i) for i in range(N_LANES)]
_PRIVATE = ("started_at", "true_count")


def _name_taken(lane: dict, board: set[str] | None = None) -> bool:
    """True if the lane's name is already on the board or on another active lane."""
    name = lane["name"].strip().lower()
    if not name:
        return False
    if board is None:
        board = db.all_names_lower()
    if name in board:
        return True
    return any(
        other is not lane and other["status"] != "empty" and other["name"].strip().lower() == name
        for other in _lanes
    )


def _public_lane(lane: dict, board: set[str] | None = None) -> dict:
    out = {k: v for k, v in lane.items() if k not in _PRIVATE}
    if lane["status"] == "running":
        out["elapsed_now"] = round(time.time() - lane["started_at"], 1)
    else:
        out["elapsed_now"] = lane["elapsed"]
    out["name_taken"] = _name_taken(lane, board)
    return out


def _public_lanes() -> dict:
    board = db.all_names_lower()
    return {"lanes": [_public_lane(lane, board) for lane in _lanes]}


def _lane(slot: int) -> dict:
    if not 0 <= slot < N_LANES:
        raise HTTPException(404, f"slot must be 0..{N_LANES - 1}")
    return _lanes[slot]


async def _broadcast_lanes() -> None:
    await hub.broadcast("lanes:update", _public_lanes())


def _manifest_images() -> dict[str, dict]:
    if not config.MANIFEST_PATH.exists():
        return {}
    with open(config.MANIFEST_PATH) as f:
        return {img["id"]: img for img in json.load(f)["images"]}


def _true_count_for(image_id: str) -> int | None:
    """scientifica.toml override > data/derived/game.json true_count > manifest cell_count."""
    override = runtime_config.truth_override(image_id)
    if override is not None:
        return override
    truth = runtime_config.game_truth(image_id)
    if truth is not None:
        return truth
    img = _manifest_images().get(image_id)
    return img["cell_count"] if img else None


def _public_entry(row: dict) -> dict:
    return {k: row[k] for k in ("id", "name", "game_image_id", "guess", "time_seconds", "score", "rank", "created_at") if k in row}


async def _submit_entry(name: str, image_id: str, guess: int, time_seconds: float, true_count: int | None) -> dict:
    """Score + persist one attempt and play its reveal on the TV leaderboard."""
    if image_id == "custom":
        if true_count is None:
            raise HTTPException(422, "custom rounds need a true_count")
    else:
        true_count = _true_count_for(image_id)
        if true_count is None:
            raise HTTPException(404, "unknown game image")
    score = scoring.compute_score(guess, true_count, time_seconds)
    entry = db.add_entry(name.strip(), image_id, guess, time_seconds, score, true_count)
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
            "guess": guess,
        },
    )
    await hub.broadcast("leaderboard:update", {"entries": [_public_entry(r) for r in db.ranked_entries(20)]})
    await _broadcast_lanes()  # name_taken flags depend on the board
    return {"entry": _public_entry(entry), "rank": rank, "total": total, "true_count": true_count}


# ---------------------------------------------------------------- lanes

_return_task: asyncio.Task | None = None


def _lanes_in_play() -> bool:
    return any(lane["status"] in ("armed", "running", "stopped") for lane in _lanes)


async def _return_to_game(delay: float) -> None:
    """After a reveal, bring the TV back to the lane grid if anyone is still playing."""
    await asyncio.sleep(delay)
    from scientifica.server import api_explore

    if api_explore._tv_state["scene"] == "leaderboard" and _lanes_in_play():
        await api_explore.force_scene("game")


def _schedule_return(rank: int) -> None:
    global _return_task
    if _return_task and not _return_task.done():
        _return_task.cancel()
    # RevealOverlay dismisses itself after 6.5 s (rank 1) / 5.2 s
    _return_task = asyncio.create_task(_return_to_game(7.0 if rank == 1 else 5.7))


async def _ensure_game_scene() -> None:
    from scientifica.server import api_explore

    if api_explore._tv_state["scene"] != "game":
        await api_explore.force_scene("game")


@router.get("/lanes")
def get_lanes():
    """Resync path; never exposes true counts."""
    return _public_lanes()


class LaneBody(BaseModel):
    name: str = Field(default="", max_length=40)
    image_id: str | None = None
    # for custom lanes (counted outside the manifest images)
    true_count: int | None = Field(default=None, gt=0)


@router.put("/lanes/{slot}")
async def set_lane(slot: int, body: LaneBody):
    """Set / edit a lane's player and field. Re-arms a stopped or done lane."""
    lane = _lane(slot)
    if lane["status"] == "running":
        raise HTTPException(409, "lane is running")
    name = body.name.strip()
    image_id = body.image_id or None
    image_url = None
    image_title = "Custom" if image_id == "custom" else None
    if image_id and image_id != "custom":
        img = _manifest_images().get(image_id)
        if img is None:
            raise HTTPException(404, "unknown image")
        image_url = img["assets"].get("display") or img["assets"]["enhanced"]
        image_title = img.get("title") or image_id
    armed = bool(name and image_id) and (image_id != "custom" or body.true_count is not None)
    lane.update(
        name=name,
        image_id=image_id,
        image_url=image_url,
        image_title=image_title,
        true_count=body.true_count if image_id == "custom" else None,
        status="armed" if armed else "empty",
        started_at=None,
        elapsed=None,
        entry_id=None,
        score=None,
        rank=None,
    )
    await _broadcast_lanes()
    return _public_lane(lane)


def _start(lane: dict, now: float) -> None:
    lane.update(status="running", started_at=now, elapsed=None, run_id=lane["run_id"] + 1)


@router.post("/lanes/start-all")
async def start_all():
    now = time.time()
    board = db.all_names_lower()
    # lanes whose name is already on the board are skipped until renamed
    armed = [lane for lane in _lanes if lane["status"] == "armed" and not _name_taken(lane, board)]
    if not armed:
        raise HTTPException(409, "no armed lane with a free name to start")
    for lane in armed:
        _start(lane, now)
    await _ensure_game_scene()
    await _broadcast_lanes()
    return _public_lanes()


@router.post("/lanes/clear")
async def clear_lanes():
    for i in range(N_LANES):
        _lanes[i] = _empty_lane(i)
    await _broadcast_lanes()
    return _public_lanes()


@router.post("/lanes/{slot}/start")
async def start_lane(slot: int):
    """Start an armed lane, or restart a stopped one from zero."""
    lane = _lane(slot)
    if lane["status"] not in ("armed", "stopped"):
        raise HTTPException(409, "lane is not armed")
    if _name_taken(lane):
        raise HTTPException(409, "name already on the board")
    _start(lane, time.time())
    await _ensure_game_scene()
    await _broadcast_lanes()
    return _public_lane(lane)


@router.post("/lanes/{slot}/stop")
async def stop_lane(slot: int):
    lane = _lane(slot)
    if lane["status"] != "running":
        raise HTTPException(409, "lane is not running")
    lane.update(status="stopped", elapsed=round(time.time() - lane["started_at"], 1), started_at=None)
    await _broadcast_lanes()
    return _public_lane(lane)


class NameBody(BaseModel):
    name: str = Field(min_length=1, max_length=40)


@router.post("/lanes/{slot}/name")
async def rename_lane(slot: int, body: NameBody):
    """Rename an armed or stopped lane (e.g. to fix a duplicate right before submit)."""
    lane = _lane(slot)
    if lane["status"] not in ("armed", "stopped"):
        raise HTTPException(409, "lane cannot be renamed now")
    lane["name"] = body.name.strip()
    await _broadcast_lanes()
    return _public_lane(lane)


class SubmitBody(BaseModel):
    guess: int = Field(ge=0)
    # operator-corrected time; defaults to the lane's stopwatch
    time_seconds: float | None = Field(default=None, gt=0)


@router.post("/lanes/{slot}/submit")
async def submit_lane(slot: int, body: SubmitBody):
    lane = _lane(slot)
    if lane["status"] != "stopped":
        raise HTTPException(409, "lane is not stopped")
    time_seconds = body.time_seconds if body.time_seconds is not None else lane["elapsed"]
    if not time_seconds or time_seconds <= 0:
        raise HTTPException(422, "time must be positive")
    res = await _submit_entry(lane["name"], lane["image_id"], body.guess, time_seconds, lane["true_count"])
    lane.update(
        status="done",
        elapsed=time_seconds,
        entry_id=res["entry"]["id"],
        score=res["entry"]["score"],
        rank=res["rank"],
    )
    _schedule_return(res["rank"])
    await _broadcast_lanes()
    return {**res, "lane": _public_lane(lane)}


@router.post("/lanes/{slot}/clear")
async def clear_lane(slot: int):
    _lane(slot)
    _lanes[slot] = _empty_lane(slot)
    await _broadcast_lanes()
    return _public_lane(_lanes[slot])


# -------------------------------------------------------------- entries


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
    """Manual entry outside the lanes (counted elsewhere, typed in by the operator)."""
    return await _submit_entry(body.name, body.game_image_id, body.guess, body.time_seconds, body.true_count)


@router.delete("/entries/{entry_id}")
async def remove_entry(entry_id: int):
    if not db.delete_entry(entry_id):
        raise HTTPException(404, "no such entry")
    # an undone lane goes back to "stopped" so the operator can resubmit it
    for lane in _lanes:
        if lane["status"] == "done" and lane["entry_id"] == entry_id:
            lane.update(status="stopped", entry_id=None, score=None, rank=None)
    await hub.broadcast("leaderboard:update", {"entries": [_public_entry(r) for r in db.ranked_entries(20)]})
    await _broadcast_lanes()
    return {"ok": True}
