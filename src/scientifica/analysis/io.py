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


def autocrop_bbox(rgb: np.ndarray) -> tuple[int, int, int, int]:
    """Bounding box (x0, y0, x1, y1) of non-black content, with margin."""
    mask = rgb.sum(axis=2) > config.CROP_THRESHOLD
    rows = np.flatnonzero(mask.any(axis=1))
    cols = np.flatnonzero(mask.any(axis=0))
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
