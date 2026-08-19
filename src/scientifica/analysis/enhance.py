"""Denoising + contrast stretch. Pure functions shared by pipeline and live compute.

All functions take/return float32 in [0, 1] per channel.
"""

import numpy as np
from skimage.filters import gaussian, median
from skimage.morphology import disk
from skimage.restoration import denoise_nl_means, estimate_sigma

DENOISE_METHODS = ("none", "gaussian", "median", "nl_means")


def to_float01(chan: np.ndarray) -> np.ndarray:
    if chan.dtype == np.uint8:
        return chan.astype(np.float32) / 255.0
    return chan.astype(np.float32)


def stretch(chan: np.ndarray, p_low: float, p_high: float) -> np.ndarray:
    """Percentile contrast stretch, computed on nonzero pixels (black padding-safe)."""
    nz = chan[chan > 0]
    if nz.size == 0:
        return chan
    lo, hi = np.percentile(nz, [p_low, p_high]).astype(np.float32)
    if hi <= lo:
        return chan
    return np.clip((chan - lo) / (hi - lo), 0.0, 1.0)


def denoise(chan: np.ndarray, method: str, strength: float) -> np.ndarray:
    """Denoise a float01 channel.

    strength is a single intuitive 0.5–5 knob:
    - gaussian: sigma in px
    - median: disk radius (rounded, >=1)
    - nl_means: multiplier on the estimated noise sigma
    """
    if method == "none" or strength <= 0:
        return chan
    if method == "gaussian":
        return gaussian(chan, sigma=strength, preserve_range=True).astype(np.float32)
    if method == "median":
        radius = max(1, round(strength))
        u8 = (np.clip(chan, 0, 1) * 255).astype(np.uint8)
        return median(u8, disk(radius)).astype(np.float32) / 255.0
    if method == "nl_means":
        sigma = float(np.mean(estimate_sigma(chan)))
        return denoise_nl_means(
            chan,
            h=max(1e-6, strength * sigma),
            sigma=sigma,
            fast_mode=True,
            patch_size=5,
            patch_distance=6,
        ).astype(np.float32)
    raise ValueError(f"unknown denoise method: {method}")


def enhance_channel(
    chan: np.ndarray,
    method: str = "gaussian",
    strength: float = 1.5,
    p_low: float = 1.0,
    p_high: float = 99.5,
) -> np.ndarray:
    """Full enhancement of one channel: denoise then contrast stretch. Returns float01."""
    f = to_float01(chan)
    f = denoise(f, method, strength)
    return stretch(f, p_low, p_high)
