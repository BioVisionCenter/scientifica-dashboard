"""Loading, black-border autocrop, and downscaling to working resolution."""

from dataclasses import dataclass

import numpy as np
from PIL import Image

from scientifica import config

Image.MAX_IMAGE_PIXELS = None


@dataclass
class LoadedImage:
    rgb: np.ndarray  # uint8 (H, W, 3), working resolution
    crop_offset_raw: tuple[int, int]  # (x0, y0) of the crop in raw coords
    scale_from_raw: float  # working px per raw px (< 1)
    raw_size: tuple[int, int]  # (width, height) before crop


def _largest_run(condition: np.ndarray, max_gap: int = 32) -> np.ndarray:
    """Indices of the largest contiguous True run (gaps <= max_gap bridged)."""
    idx = np.flatnonzero(condition)
    if len(idx) == 0:
        return idx
    breaks = np.flatnonzero(np.diff(idx) > max_gap)
    starts = np.concatenate(([0], breaks + 1))
    ends = np.concatenate((breaks, [len(idx) - 1]))
    best = np.argmax(idx[ends] - idx[starts])
    return idx[starts[best] : ends[best] + 1]


def autocrop_bbox(rgb: np.ndarray) -> tuple[int, int, int, int]:
    """Bounding box (x0, y0, x1, y1) of non-black content, with margin."""
    mask = rgb.sum(axis=2) > config.CROP_THRESHOLD
    # Keep the largest contiguous run of content rows/cols: detached artifacts
    # (scale bars) outside the field then can't extend the bbox.
    rows = _largest_run(mask.mean(axis=1) > 0.002)
    cols = _largest_run(mask.mean(axis=0) > 0.002)
    if len(rows) == 0:
        return 0, 0, rgb.shape[1], rgb.shape[0]
    m = config.CROP_MARGIN
    y0 = max(0, int(rows[0]) - m)
    y1 = min(rgb.shape[0], int(rows[-1]) + 1 + m)
    x0 = max(0, int(cols[0]) - m)
    x1 = min(rgb.shape[1], int(cols[-1]) + 1 + m)
    return x0, y0, x1, y1


def load_working_image(path, long_side: int) -> LoadedImage:
    """Load a raw composite PNG: drop alpha, autocrop black border, downscale."""
    img = Image.open(path)
    raw_size = img.size
    if img.mode != "RGB":
        img = img.convert("RGB")
    rgb = np.asarray(img)
    x0, y0, x1, y1 = autocrop_bbox(rgb)
    cropped = Image.fromarray(rgb[y0:y1, x0:x1])
    del rgb, img

    w, h = cropped.size
    scale = min(1.0, long_side / max(w, h))
    if scale < 1.0:
        cropped = cropped.resize(
            (round(w * scale), round(h * scale)), Image.Resampling.LANCZOS
        )
    return LoadedImage(
        rgb=np.asarray(cropped),
        crop_offset_raw=(x0, y0),
        scale_from_raw=scale,
        raw_size=raw_size,
    )
