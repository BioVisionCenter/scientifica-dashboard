"""Live re-segmentation: one async job at a time, tiled through ngio iterators.

The job segments the ROI's bbox (or the drawn rectangle inside it — both in
level-0 pixels of the whole well) into a new `live_<roi>_<job>` label of the
shared OME-Zarr, measures it into a FeatureTable + viewer json, and streams
tile progress over the websocket hub.
"""

import asyncio
import math
import threading
import time
from typing import Literal

from fastapi import APIRouter, HTTPException
from ngio import SegmentationIterator
from ngio.iterators import StitchConfig, ThreadedMapper
from ngio.tables import RoiTable
from pydantic import BaseModel, Field
from zarr.storage import MemoryStore

from scientifica import config
from scientifica.analysis import enhance, measure, segment, store
from scientifica.server.ws import hub

router = APIRouter(prefix="/api/compute")

_job_lock = asyncio.Lock()
_jobs: dict[str, dict] = {}
_cancels: dict[str, threading.Event] = {}

MEMORY_SCRATCH_MAX_TILES = 64


class Region(BaseModel):
    x: int = Field(ge=0)
    y: int = Field(ge=0)
    width: int = Field(gt=0)
    height: int = Field(gt=0)


class SegmentBody(BaseModel):
    image_id: str
    region: Region | None = None  # None -> the whole ROI bbox
    diameter_px: float = Field(gt=4, le=1000)
    sensitivity: float = Field(default=50, ge=0, le=100)
    segmenter: Literal["cellpose", "otsu"] = "cellpose"
    method: str = "gaussian"
    strength: float = Field(default=1.5, ge=0, le=10)


def _stitch_block_size(diameter_px: float, halo: int) -> int:
    tile_area = (config.LIVE_TILE + 2 * halo) ** 2
    cell_area = math.pi * (diameter_px / 2) ** 2
    return int(max(10_000, 4 * tile_area / cell_area))


def _segment_sync(job_id: str, body: SegmentBody, loop: asyncio.AbstractEventLoop) -> dict:
    """Blocking part of the job (runs in a worker thread)."""
    t0 = time.time()
    cancel = _cancels[job_id]
    ome = store.open_container()
    image = ome.get_image()
    box = store.roi_boxes(ome)[body.image_id]

    if body.region is not None:
        r = body.region
        area = box.intersect(r.x, r.y, r.width, r.height)
        if area is None:
            raise ValueError("the region does not overlap this ROI")
    else:
        area = box
    cap = config.LIVE_MAX_PIXELS[body.segmenter]
    if area.pixels > cap:
        raise ValueError(
            f"{body.segmenter} on {area.pixels / 1e6:.0f} MP exceeds the {cap / 1e6:.0f} MP live cap; "
            "draw a smaller region"
        )
    region_roi = area.to_roi(ome, "live_region")

    label_name = store.live_label_name(body.image_id, job_id)
    live = ome.derive_label(
        label_name,
        channels_policy="squeeze",
        dtype="uint32",
        chunks=store.label_chunks(ome),
        overwrite=True,
    )

    it = SegmentationIterator(
        image, live,
        channel_selection=config.CHANNEL_DEFS[config.NUCLEI_CHANNEL],
        axes_order=["y", "x"],
        consolidation_mode="auto",
    ).product([region_roi])
    halo = int(max(32, math.ceil(2 * body.diameter_px / 16) * 16))
    if area.width > config.LIVE_TILE or area.height > config.LIVE_TILE:
        # big regions (hero, Field 13, large drawn rects) are tiled + stitched;
        # anything that fits in one tile runs as a single seamless call
        it = it.by_grid(size_x=config.LIVE_TILE, size_y=config.LIVE_TILE, tail="balance").with_halo(
            x=halo, y=halo
        )
    total = len(it.rois)
    if total > 1:
        scratch = MemoryStore() if total <= MEMORY_SCRATCH_MAX_TILES else None
        it = it.with_stitch(
            StitchConfig(
                block_size=_stitch_block_size(body.diameter_px, halo),
                iou_threshold=0.3,
                scratch_store=scratch,
            )
        )

    done = 0
    count_lock = threading.Lock()

    def emit(stage: str) -> None:
        payload = {"job_id": job_id, "stage": stage, "done": done, "total": total}
        _jobs[job_id].update(stage=stage, done=done, total=total)
        asyncio.run_coroutine_threadsafe(hub.broadcast("job:progress", payload), loop)

    def tick() -> None:
        nonlocal done
        with count_lock:
            done += 1
        emit("segmenting")

    emit("segmenting")
    func = segment.make_tile_segmenter(
        body.segmenter,
        body.diameter_px,
        body.sensitivity,
        store.channel_windows(ome)[config.NUCLEI_CHANNEL],
        body.method,
        body.strength,
        on_tile=tick,
        cancel=cancel,
    )
    it.segment(func, mapper=ThreadedMapper(segment.workers_for(body.segmenter)))

    if cancel.is_set():
        raise segment.JobCancelled()
    emit("measuring")
    table, cells = measure.measure_label(
        ome, label_name, region_roi, body.diameter_px,
        bounds=(area.x, area.y, area.x1, area.y1),
        mapper=ThreadedMapper(config.FEATURE_WORKERS),
    )
    ome.add_table(f"{label_name}_features", table, overwrite=True)
    ome.add_table(f"{label_name}_region", RoiTable(rois=[region_roi]), overwrite=True)
    cells_url = store.write_cells_json(body.image_id, label_name, measure.FEATURE_KEYS, cells)
    store.prune_live(ome, body.image_id)
    return {
        "job_id": job_id,
        "image_id": body.image_id,
        "label": label_name,
        "label_url": store.label_url(label_name),
        "cells_url": cells_url,
        "region": area.as_dict(),
        "count": len(cells),
        "seconds": round(time.time() - t0, 1),
    }


async def _run_segment_job(job_id: str, body: SegmentBody) -> None:
    loop = asyncio.get_running_loop()
    try:
        result = await asyncio.to_thread(_segment_sync, job_id, body, loop)
        _jobs[job_id].update(status="done", stage="done", result=result)
        await hub.broadcast("job:done", result)
    except segment.JobCancelled:
        _jobs[job_id].update(status="cancelled", stage="cancelled")
        await asyncio.to_thread(_discard_live, body.image_id, job_id)
        await hub.broadcast("job:error", {"job_id": job_id, "stage": "cancelled", "error": "cancelled"})
    except Exception as exc:  # surface errors to the UI instead of hanging the job
        _jobs[job_id].update(status="error", stage="error", error=str(exc))
        await asyncio.to_thread(_discard_live, body.image_id, job_id)
        await hub.broadcast("job:error", {"job_id": job_id, "stage": "error", "error": str(exc)})
    finally:
        _cancels.pop(job_id, None)
        _job_lock.release()


def _discard_live(image_id: str, job_id: str) -> None:
    try:
        store.discard_live(store.open_container(), image_id, store.live_label_name(image_id, job_id))
    except Exception:
        pass


@router.post("/segment")
async def compute_segment(body: SegmentBody):
    if body.method not in enhance.DENOISE_METHODS:
        raise HTTPException(422, f"method must be one of {enhance.DENOISE_METHODS}")
    try:
        boxes = store.roi_boxes(store.open_container())
    except FileNotFoundError as exc:
        raise HTTPException(503, str(exc)) from exc
    if body.image_id not in boxes:
        raise HTTPException(404, f"unknown ROI {body.image_id}")
    if _job_lock.locked():
        raise HTTPException(409, "a segmentation is already running")
    await _job_lock.acquire()
    job_id = f"{int(time.time() * 1000):x}"  # time-sortable: pruning keeps the newest
    _jobs[job_id] = {"status": "running", "stage": "queued", "done": 0, "total": 0, "result": None}
    _cancels[job_id] = threading.Event()
    asyncio.create_task(_run_segment_job(job_id, body))
    return {"job_id": job_id}


@router.get("/jobs/{job_id}")
async def job_status(job_id: str):
    if job_id not in _jobs:
        raise HTTPException(404, "unknown job")
    return _jobs[job_id]


@router.post("/jobs/{job_id}/cancel")
async def cancel_job(job_id: str):
    if job_id not in _jobs:
        raise HTTPException(404, "unknown job")
    ev = _cancels.get(job_id)
    if ev is not None:
        ev.set()
    return {"ok": True}
