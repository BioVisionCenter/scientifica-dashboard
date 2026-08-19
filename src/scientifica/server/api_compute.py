"""Live re-compute: sync enhance, async cellpose segment job (one at a time)."""

import asyncio
import base64
import io as _io
import json
import uuid

import numpy as np
from fastapi import APIRouter, HTTPException, Response
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


@router.post("/enhance")
async def compute_enhance(body: EnhanceBody):
    rgb = _load_region(body.image_id, body.region)
    enh_n, enh_m = await asyncio.to_thread(
        _enhance_channels, rgb, body.method, body.strength, body.stretch
    )
    out = channels.composite(enh_n, enh_m, config.NUCLEI_HEX, config.MEMBRANE_HEX)
    buf = _io.BytesIO()
    Image.fromarray(out).save(buf, format="PNG")
    return Response(content=buf.getvalue(), media_type="image/png")


class SegmentBody(EnhanceBody):
    diameter_px: float = Field(gt=4, le=500)
    sensitivity: float = Field(default=50, ge=0, le=100)


def _png_b64(img: Image.Image) -> str:
    buf = _io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


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
            "cells": cells,
            "outlines_png_b64": _png_b64(render.render_outlines(labels)),
            "labels_rgb_png_b64": _png_b64(render.encode_labels_rgb(labels)),
            "region": body.region.model_dump() if body.region else None,
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
