"""Live re-compute: sync enhance, async cellpose segment job (one at a time)."""

import asyncio
import json
import uuid

import numpy as np
from fastapi import APIRouter, HTTPException
from PIL import Image
from pydantic import BaseModel, Field

from scientifica import config
from scientifica.analysis import channels, enhance, measure, render, segment
from scientifica.server.ws import hub

router = APIRouter(prefix="/api/compute")

_job_lock = asyncio.Lock()
_jobs: dict[str, dict] = {}


class Region(BaseModel):
    x: int = Field(ge=0)
    y: int = Field(ge=0)
    width: int = Field(gt=0)
    height: int = Field(gt=0)


class EnhanceBody(BaseModel):
    image_id: str
    region: Region | None = None
    method: str = "gaussian"
    strength: float = Field(default=1.5, ge=0, le=10)
    stretch: tuple[float, float] = (1.0, 99.5)


def _load_region(image_id: str, region: Region | None) -> np.ndarray:
    path = config.DERIVED_DIR / image_id / "raw.jpg"
    if not path.exists():
        raise HTTPException(404, f"unknown image {image_id}")
    img = Image.open(path)
    if region is not None:
        max_side = config.LIVE_REGION_MAX
        if region.width > max_side or region.height > max_side:
            raise HTTPException(422, f"region larger than {max_side}px cap")
        img = img.crop((region.x, region.y, region.x + region.width, region.y + region.height))
    else:
        if max(img.size) > config.LIVE_REGION_MAX:
            raise HTTPException(422, "full image exceeds live cap; send a region")
    return np.asarray(img.convert("RGB"))


def _enhance_channels(rgb: np.ndarray, method: str, strength: float, stretch: tuple[float, float]):
    if method not in enhance.DENOISE_METHODS:
        raise HTTPException(422, f"method must be one of {enhance.DENOISE_METHODS}")
    nuclei, membrane = channels.split_channels(rgb)
    enh_n = enhance.enhance_channel(nuclei, method, strength, *stretch)
    enh_m = enhance.enhance_channel(membrane, method, strength, *stretch)
    return enh_n, enh_m


# live results land in the served assets dir so every screen (operator AND
# the mirroring TV) loads the exact same file
LIVE_DIR = config.DERIVED_DIR / "_live"


def _save_live(name: str, payload) -> str:
    LIVE_DIR.mkdir(parents=True, exist_ok=True)
    path = LIVE_DIR / name
    if isinstance(payload, Image.Image):
        payload.save(path)
    else:
        path.write_text(json.dumps(payload))
    _prune_live()
    return f"/assets/_live/{name}"


def _prune_live(keep: int = 24) -> None:
    files = sorted(LIVE_DIR.glob("*"), key=lambda p: p.stat().st_mtime, reverse=True)
    for stale in files[keep:]:
        stale.unlink(missing_ok=True)


class SegmentBody(EnhanceBody):
    diameter_px: float = Field(gt=4, le=500)
    sensitivity: float = Field(default=50, ge=0, le=100)


async def _run_segment_job(job_id: str, body: SegmentBody) -> None:
    async def progress(stage: str) -> None:
        _jobs[job_id]["stage"] = stage
        await hub.broadcast("job:progress", {"job_id": job_id, "stage": stage})

    try:
        rgb = _load_region(body.image_id, body.region)
        await progress("enhancing")
        enh_n, enh_m = await asyncio.to_thread(
            _enhance_channels, rgb, body.method, body.strength, body.stretch
        )
        await progress("segmenting")
        labels = await asyncio.to_thread(
            segment.segment, enh_n, enh_m, body.diameter_px, body.sensitivity
        )
        await progress("measuring")
        cells = await asyncio.to_thread(measure.measure_cells, labels, enh_n, enh_m)
        result = {
            "count": int(labels.max()),
            "region": body.region.model_dump() if body.region else None,
            "outlines_url": _save_live(f"{job_id}_outlines.png", render.render_outlines(labels)),
            "cells_url": _save_live(f"{job_id}_cells.json", cells),
        }
        _jobs[job_id].update(status="done", stage="done", result=result)
        await hub.broadcast("job:done", {"job_id": job_id, "count": result["count"]})
    except Exception as exc:  # surface errors to the UI instead of hanging the job
        _jobs[job_id].update(status="error", error=str(exc))
        await hub.broadcast("job:error", {"job_id": job_id, "error": str(exc)})
    finally:
        _job_lock.release()


@router.post("/segment")
async def compute_segment(body: SegmentBody):
    if _job_lock.locked():
        raise HTTPException(409, "a segmentation is already running")
    await _job_lock.acquire()
    job_id = uuid.uuid4().hex[:12]
    _jobs[job_id] = {"status": "running", "stage": "queued", "result": None}
    asyncio.create_task(_run_segment_job(job_id, body))
    return {"job_id": job_id}


@router.get("/jobs/{job_id}")
async def job_status(job_id: str):
    if job_id not in _jobs:
        raise HTTPException(404, "unknown job")
    return _jobs[job_id]
