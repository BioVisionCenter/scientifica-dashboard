"""Loading: napari display pngs and raw channel/label tiffs.

Everything displayed is landscape: content is rotated 90° (always the same
`np.rot90(a, k=-1)`) whenever it is taller than wide. The rotation decision is
made ONCE per ROI from the channel tiff shape and shared with the label loader
so channels, labels, features and polygons stay in one coordinate frame.
"""

import numpy as np
import tifffile
from PIL import Image

from scientifica import config

Image.MAX_IMAGE_PIXELS = None


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


def to_landscape(a: np.ndarray) -> np.ndarray:
    """Rotate 90° so width >= height. Every rotation in the project uses k=-1."""
    return np.rot90(a, k=-1) if a.shape[0] > a.shape[1] else a


def load_display_png(path, long_side: int) -> np.ndarray:
    """Napari render: drop alpha, autocrop black padding, landscape, downscale."""
    img = Image.open(path)
    if img.mode != "RGB":
        img = img.convert("RGB")
    rgb = np.asarray(img)
    x0, y0, x1, y1 = autocrop_bbox(rgb)
    rgb = to_landscape(rgb[y0:y1, x0:x1])
    h, w = rgb.shape[:2]
    scale = min(1.0, long_side / w)
    out = Image.fromarray(rgb)
    if scale < 1.0:
        out = out.resize((round(w * scale), round(h * scale)), Image.Resampling.LANCZOS)
    return np.asarray(out)


def load_channel_tiff(path, long_side: int) -> tuple[np.ndarray, bool, tuple[int, int]]:
    """Raw uint16 channel -> (uint8 working-size grayscale, rotated, raw (lo, hi)).

    The percentile window config.CHANNEL_STRETCH is baked into the 8-bit output;
    the original intensity bounds of that window are returned as raw_range.
    """
    arr = tifffile.imread(path)
    # Huge inputs (the hero overview): halve by striding before any float work
    while max(arr.shape) > 4 * long_side:
        arr = arr[::2, ::2]
    rotated = arr.shape[0] > arr.shape[1]
    if rotated:
        arr = np.rot90(arr, k=-1)
    sample = arr[::4, ::4] if max(arr.shape) > 8192 else arr
    nz = sample[sample > 0]
    if nz.size == 0:
        nz = sample.reshape(-1)
    lo, hi = np.percentile(nz, config.CHANNEL_STRETCH)
    if hi <= lo:
        hi = lo + 1
    u8 = (np.clip((arr.astype(np.float32) - lo) / (hi - lo), 0.0, 1.0) * 255).astype(np.uint8)

    h, w = u8.shape
    scale = min(1.0, long_side / w)
    img = Image.fromarray(u8)
    if scale < 1.0:
        img = img.resize((round(w * scale), round(h * scale)), Image.Resampling.LANCZOS)
    return np.asarray(img), rotated, (int(lo), int(hi))


def load_labels_tiff(path, target_hw: tuple[int, int], rotate: bool) -> np.ndarray:
    """Curated nuclei labels -> int32 at exactly target_hw, ids relabeled 1..N.

    `rotate` comes from the ROI's channel tiff — never decided here — so labels
    land in the same landscape frame as the channels.
    """
    from skimage.segmentation import relabel_sequential

    arr = tifffile.imread(path).astype(np.int32)
    if rotate:
        arr = np.rot90(arr, k=-1)
    th, tw = target_hw
    # NEAREST also absorbs the ~1/4-scale label crops (B03 ROIs) and the
    # non-integer factors that come with them.
    while arr.shape[1] > 2 * tw:
        arr = arr[::2, ::2]
    if arr.shape != (th, tw):
        img = Image.fromarray(arr, mode="I").resize((tw, th), Image.Resampling.NEAREST)
        arr = np.array(img, dtype=np.int32)  # writable copy (PIL buffers are read-only)
    return relabel_sequential(np.ascontiguousarray(arr))[0].astype(np.int32)
