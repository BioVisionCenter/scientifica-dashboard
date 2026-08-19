"""Channel extraction from the cyan/magenta RGB composite.

The composites render nuclei in cyan (G+B) and membranes in magenta (R+B),
so G is the unique nuclei signal, R the unique membrane signal, and B is the
shared component we ignore.
"""

import numpy as np


def hex_to_rgb01(hex_color: str) -> np.ndarray:
    h = hex_color.lstrip("#")
    return np.array([int(h[i : i + 2], 16) / 255.0 for i in (0, 2, 4)], dtype=np.float32)


def split_channels(rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Return (nuclei, membrane) uint8 grayscale channels."""
    return rgb[..., 1].copy(), rgb[..., 0].copy()


def composite(nuclei: np.ndarray, membrane: np.ndarray, nuclei_hex: str, membrane_hex: str) -> np.ndarray:
    """Recomposite two grayscale channels (uint8 or float01) into an RGB uint8 image."""
    out = np.zeros((*nuclei.shape, 3), dtype=np.float32)
    for chan, hex_color in ((nuclei, nuclei_hex), (membrane, membrane_hex)):
        f = chan.astype(np.float32)
        if chan.dtype == np.uint8:
            f /= 255.0
        out += f[..., None] * hex_to_rgb01(hex_color)
    return (np.clip(out, 0, 1) * 255).astype(np.uint8)
