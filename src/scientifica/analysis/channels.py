"""Compositing grayscale channels into an RGB display image."""

import numpy as np


def hex_to_rgb01(hex_color: str) -> np.ndarray:
    h = hex_color.lstrip("#")
    return np.array([int(h[i : i + 2], 16) / 255.0 for i in (0, 2, 4)], dtype=np.float32)


def composite(channels: list[tuple[np.ndarray, str]]) -> np.ndarray:
    """Additively blend (grayscale uint8-or-float01, hex color) pairs into RGB uint8."""
    first = channels[0][0]
    out = np.zeros((*first.shape, 3), dtype=np.float32)
    for chan, hex_color in channels:
        f = chan.astype(np.float32)
        if chan.dtype == np.uint8:
            f /= 255.0
        out += f[..., None] * hex_to_rgb01(hex_color)
    return (np.clip(out, 0, 1) * 255).astype(np.uint8)
