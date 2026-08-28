"""Render label maps into poster overlays (TV idle show): outlines PNG."""

import numpy as np
from PIL import Image
from skimage.morphology import dilation, disk
from skimage.segmentation import find_boundaries

OUTLINE_HEX = "#ffe94f"


def _hex_to_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


def downscale_rgba(img: Image.Image, size: tuple[int, int]) -> Image.Image:
    """Resample an overlay to (w, h) without the dark fringes a plain resize leaves.

    PIL resamples RGB independently of alpha, so the transparent (0,0,0,0)
    background bleeds into every edge pixel. Premultiplying first keeps the
    color of the visible ink and only fades its alpha. BOX (area average) rather
    than LANCZOS: the reduction is always an exact integer factor,
    and lanczos ringing would halo the thin outlines.
    """
    if img.size == size:
        return img
    a = np.asarray(img, dtype=np.float32)
    alpha = a[..., 3:4] / 255.0
    pre = np.concatenate([a[..., :3] * alpha, a[..., 3:4]], axis=-1)
    small = np.asarray(
        Image.fromarray(np.rint(pre).astype(np.uint8), mode="RGBA").resize(
            size, Image.Resampling.BOX
        ),
        dtype=np.float32,
    )
    out_a = small[..., 3:4]
    rgb = np.divide(small[..., :3] * 255.0, out_a, out=np.zeros_like(small[..., :3]), where=out_a > 0)
    out = np.concatenate([np.clip(rgb, 0, 255), out_a], axis=-1)
    return Image.fromarray(out.astype(np.uint8), mode="RGBA")


def render_outlines(labels: np.ndarray, thickness: int = 2) -> Image.Image:
    """Transparent RGBA overlay with colored cell outlines.

    The color fills the whole buffer and only alpha carries the boundaries, so a
    later `downscale_rgba` round-trip reproduces the ink color exactly.
    """
    boundaries = find_boundaries(labels, mode="outer")
    if thickness > 1:
        boundaries = dilation(boundaries, disk(thickness - 1))
    rgba = np.zeros((*labels.shape, 4), dtype=np.uint8)
    rgba[..., :3] = _hex_to_rgb(OUTLINE_HEX)
    rgba[..., 3] = boundaries * 255
    return Image.fromarray(rgba, mode="RGBA")
