"""Cellpose wrapper: cached model, device pick, intuitive parameter mapping."""

import os
from functools import lru_cache

import numpy as np

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")


def sensitivity_to_cellprob(sensitivity: float) -> float:
    """Map the 0-100 UI 'sensitivity' knob to cellprob_threshold +3..-3.

    High sensitivity -> low threshold -> more (dimmer) cells accepted.
    """
    s = float(np.clip(sensitivity, 0, 100))
    return 3.0 - 6.0 * s / 100.0


@lru_cache(maxsize=1)
def get_model():
    from cellpose import models

    return models.CellposeModel(model_type="cyto3", gpu=True)


def warmup() -> None:
    """Load the model and run a dummy inference so the first real request is fast."""
    dummy = np.zeros((2, 128, 128), dtype=np.float32)
    segment(dummy[0], dummy[1], diameter=30.0, sensitivity=50)


def estimate_diameter(nuclei: np.ndarray, membrane: np.ndarray) -> float:
    from cellpose import models

    size_model = models.Cellpose(model_type="cyto3", gpu=True)
    img = np.stack([membrane, nuclei])
    diam, _ = size_model.sz.eval(img, channels=[1, 2], channel_axis=0)
    return float(diam)


def segment(
    nuclei: np.ndarray,
    membrane: np.ndarray,
    diameter: float,
    sensitivity: float = 50,
) -> np.ndarray:
    """Run cellpose on (membrane=cyto, nuclei=nuclear) channels. Returns int32 labels."""
    model = get_model()
    img = np.stack([membrane.astype(np.float32), nuclei.astype(np.float32)])
    masks, _, _ = model.eval(
        img,
        channels=[1, 2],  # cyto = channel 1 (membrane), nucleus = channel 2 (nuclei)
        channel_axis=0,
        diameter=diameter,
        cellprob_threshold=sensitivity_to_cellprob(sensitivity),
        flow_threshold=0.4,
    )
    return masks.astype(np.int32)
