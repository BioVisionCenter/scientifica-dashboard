"""Render label maps into web assets: id-encoded PNG, outlines, translucent mask."""

import numpy as np
from PIL import Image
from skimage.morphology import dilation, disk
from skimage.segmentation import find_boundaries

# Categorical fill palette for the mask overlay (cycled per label)
MASK_PALETTE = [
    "#4f9cf9", "#f9744f", "#39c98e", "#f2c14e", "#b07ff5",
    "#f56fa1", "#4fd8e0", "#a4e057", "#f5a04f", "#7f8ff5",
]
OUTLINE_HEX = "#ffe94f"


def _hex_to_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


def encode_labels_rgb(labels: np.ndarray) -> Image.Image:
    """Encode int label ids into an opaque RGB PNG: id = R + 256*G + 65536*B."""
    ids = labels.astype(np.uint32)
    rgb = np.zeros((*labels.shape, 3), dtype=np.uint8)
    rgb[..., 0] = ids & 0xFF
    rgb[..., 1] = (ids >> 8) & 0xFF
    rgb[..., 2] = (ids >> 16) & 0xFF
    return Image.fromarray(rgb, mode="RGB")


def render_outlines(labels: np.ndarray, thickness: int = 2) -> Image.Image:
    """Transparent RGBA overlay with colored cell outlines."""
    boundaries = find_boundaries(labels, mode="outer")
    if thickness > 1:
        boundaries = dilation(boundaries, disk(thickness - 1))
    rgba = np.zeros((*labels.shape, 4), dtype=np.uint8)
    rgba[boundaries] = [*_hex_to_rgb(OUTLINE_HEX), 255]
    return Image.fromarray(rgba, mode="RGBA")


def render_mask(labels: np.ndarray, alpha: int = 110) -> Image.Image:
    """Transparent RGBA overlay with translucent per-cell fills, palette cycled."""
    palette = np.array([_hex_to_rgb(c) for c in MASK_PALETTE], dtype=np.uint8)
    rgba = np.zeros((*labels.shape, 4), dtype=np.uint8)
    fg = labels > 0
    colors = palette[(labels[fg] - 1) % len(palette)]
    rgba[fg, :3] = colors
    rgba[fg, 3] = alpha
    return Image.fromarray(rgba, mode="RGBA")
