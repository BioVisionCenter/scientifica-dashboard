"""All OME-Zarr I/O goes through here (ngio). ONE container for everything:

    data/source/<SOURCE_ZARR_NAME>
        0..4                          whole-well image (c, z, y, x) uint16 pyramid
        labels/nuclei                 whole-well segmentation (uint32)
        labels/live_<roi>_<job>       live re-segmentations, pruned to LIVE_KEEP per ROI
        tables/<ROI_TABLE>            the dashboard ROIs (bboxes in world µm)
        tables/nuclei_features        FeatureTable of the whole-well label
        tables/live_*_features|region tables of the live runs
    data/derived/<roi>/cells_<label>.json   per-ROI cell records (global level-0 px)
"""

import json
import math
from dataclasses import dataclass
from pathlib import Path

from ngio import OmeZarrContainer, Roi, open_ome_zarr_container

from scientifica import config


def open_container(cache: bool = False) -> OmeZarrContainer:
    path = config.zarr_path()
    if not path.is_dir():
        raise FileNotFoundError(f"source OME-Zarr missing at {path}")
    return open_ome_zarr_container(path, cache=cache)


def image_shape_yx(ome: OmeZarrContainer) -> tuple[int, int]:
    shape = ome.get_image().shape
    return int(shape[-2]), int(shape[-1])


def image_shape_cyx(ome: OmeZarrContainer) -> tuple[int, int, int]:
    image = ome.get_image()
    h, w = image_shape_yx(ome)
    return len(image.channel_labels), h, w


def label_chunks(ome: OmeZarrContainer) -> tuple[int, ...]:
    """Chunks for derive_label, given at the reference image's rank."""
    rank = len(ome.get_image().shape)
    return (1,) * (rank - 2) + tuple(config.LABEL_CHUNKS)


@dataclass(frozen=True)
class RoiBox:
    """A dashboard ROI as an integer bbox in level-0 pixels."""

    id: str
    x: int
    y: int
    width: int
    height: int

    @property
    def x1(self) -> int:
        return self.x + self.width

    @property
    def y1(self) -> int:
        return self.y + self.height

    @property
    def pixels(self) -> int:
        return self.width * self.height

    def contains(self, cx: float, cy: float) -> bool:
        return self.x <= cx < self.x1 and self.y <= cy < self.y1

    def intersect(self, x: int, y: int, width: int, height: int) -> "RoiBox | None":
        x0, y0 = max(self.x, x), max(self.y, y)
        x1, y1 = min(self.x1, x + width), min(self.y1, y + height)
        if x1 <= x0 or y1 <= y0:
            return None
        return RoiBox(self.id, x0, y0, x1 - x0, y1 - y0)

    def to_roi(self, ome: OmeZarrContainer, name: str | None = None) -> Roi:
        return pixel_roi(ome, self.x, self.y, self.width, self.height, name or self.id)

    def as_dict(self) -> dict:
        return {"x": self.x, "y": self.y, "width": self.width, "height": self.height}


_boxes_cache: dict[str, RoiBox] | None = None


def roi_boxes(ome: OmeZarrContainer, refresh: bool = False) -> dict[str, RoiBox]:
    """ROI table rows -> integer level-0 bboxes (floor start, ceil end), in table order."""
    global _boxes_cache
    if _boxes_cache is not None and not refresh:
        return _boxes_cache
    image = ome.get_image()
    h, w = image_shape_yx(ome)
    boxes: dict[str, RoiBox] = {}
    for roi in ome.get_table(config.ROI_TABLE).rois():
        p = roi.to_pixel(image.pixel_size)
        xs, ys = p["x"], p["y"]
        x0 = max(0, int(math.floor(xs.start)))
        y0 = max(0, int(math.floor(ys.start)))
        x1 = min(w, int(math.ceil(xs.start + xs.length)))
        y1 = min(h, int(math.ceil(ys.start + ys.length)))
        name = roi.get_name()
        boxes[name] = RoiBox(name, x0, y0, x1 - x0, y1 - y0)
    _boxes_cache = boxes
    return boxes


def roi_ids_sorted(boxes: dict[str, RoiBox]) -> list[str]:
    def key(i: str):
        try:
            return int(i.split("_")[1])
        except (IndexError, ValueError):
            return 10**6
    return sorted(boxes, key=key)


def channel_index(ome: OmeZarrContainer, key: str) -> int:
    return ome.get_image().channel_labels.index(config.CHANNEL_DEFS[key])


def channel_windows(ome: OmeZarrContainer) -> dict[str, tuple[float, float]]:
    """Channel key -> (start, end) from the omero metadata."""
    out = {}
    label_to_key = {v: k for k, v in config.CHANNEL_DEFS.items()}
    for ch in ome.get_image().channels_meta.channels:
        vis = ch.channel_visualisation
        out[label_to_key.get(ch.label, ch.label)] = (float(vis.start), float(vis.end))
    return out


def channel_meta_records(ome: OmeZarrContainer) -> list[dict]:
    """Manifest channel entries (key, label, color, window, index)."""
    label_to_key = {v: k for k, v in config.CHANNEL_DEFS.items()}
    records = []
    for i, ch in enumerate(ome.get_image().channels_meta.channels):
        vis = ch.channel_visualisation
        records.append(
            {
                "key": label_to_key.get(ch.label, ch.label),
                "label": ch.label,
                "color": str(vis.color).lstrip("#").upper(),
                "window": {
                    "min": float(vis.min),
                    "max": float(vis.max),
                    "start": float(vis.start),
                    "end": float(vis.end),
                },
                "index": i,
            }
        )
    return records


def pixel_roi(ome: OmeZarrContainer, x: int, y: int, width: int, height: int, name: str) -> Roi:
    """A level-0 pixel bbox as a world-space Roi (what the iterators expect)."""
    roi = Roi.from_values(
        slices={"x": (int(x), int(width)), "y": (int(y), int(height))}, name=name, space="pixel"
    )
    return roi.to_world(ome.get_image().pixel_size)


def image_roi(ome: OmeZarrContainer, name: str = "image") -> Roi:
    h, w = image_shape_yx(ome)
    return pixel_roi(ome, 0, 0, w, h, name)


def roi_pixel_box(roi: Roi, ome: OmeZarrContainer) -> tuple[int, int, int, int]:
    """(x0, y0, x1, y1) int pixel bounds of a ROI in level-0 space."""
    p = roi.to_pixel(ome.get_image().pixel_size)
    xs, ys = p["x"], p["y"]
    return (
        int(round(xs.start)),
        int(round(ys.start)),
        int(round(xs.start + xs.length)),
        int(round(ys.start + ys.length)),
    )


# --- live labels (per ROI) -------------------------------------------------

def live_label_name(image_id: str, job_id: str) -> str:
    return f"{config.LIVE_LABEL_PREFIX}{image_id}_{job_id}"


def live_label_names(ome: OmeZarrContainer, image_id: str) -> list[str]:
    """This ROI's live labels, oldest first (job ids are time-sortable)."""
    prefix = f"{config.LIVE_LABEL_PREFIX}{image_id}_"
    return sorted(n for n in ome.list_labels() if n.startswith(prefix))


def discard_live(ome: OmeZarrContainer, image_id: str, label_name: str) -> None:
    ome.delete_label(label_name, missing_ok=True)
    ome.delete_table(f"{label_name}_features", missing_ok=True)
    ome.delete_table(f"{label_name}_region", missing_ok=True)
    cells_path(image_id, label_name).unlink(missing_ok=True)


def prune_live(ome: OmeZarrContainer, image_id: str, keep: int = config.LIVE_KEEP) -> None:
    names = live_label_names(ome, image_id)
    for stale in names[: max(0, len(names) - keep)]:
        discard_live(ome, image_id, stale)


# --- derived files ----------------------------------------------------------

def cells_path(image_id: str, label_name: str) -> Path:
    return config.roi_dir(image_id) / f"cells_{label_name}.json"


def cells_url(image_id: str, label_name: str) -> str:
    return f"/assets/{image_id}/cells_{label_name}.json"


def label_url(label_name: str) -> str:
    return f"{config.zarr_url()}/labels/{label_name}"


def write_cells_json(image_id: str, label_name: str, features: list[dict], cells: list[dict]) -> str:
    path = cells_path(image_id, label_name)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"label": label_name, "features": features, "cells": cells}))
    return cells_url(image_id, label_name)
