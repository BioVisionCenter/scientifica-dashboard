"""Segmentation backends: cellpose (AI) and Otsu (classic), same label output."""

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
    dummy = np.zeros((128, 128), dtype=np.float32)
    segment(dummy, None, diameter=30.0, sensitivity=50)


def segment(
    nuclei: np.ndarray,
    membrane: np.ndarray | None,
    diameter: float,
    sensitivity: float = 50,
) -> np.ndarray:
    """Run cellpose on the nuclei channel (grayscale; membrane optionally added
    as the cyto channel). Returns int32 labels."""
    model = get_model()
    if membrane is None:
        img = nuclei.astype(np.float32)
        chans = [0, 0]  # grayscale
    else:
        img = np.stack([membrane.astype(np.float32), nuclei.astype(np.float32)])
        chans = [1, 2]  # cyto = channel 1 (membrane), nucleus = channel 2 (nuclei)
    masks, _, _ = model.eval(
        img,
        channels=chans,
        channel_axis=0 if membrane is not None else None,
        diameter=diameter,
        cellprob_threshold=sensitivity_to_cellprob(sensitivity),
        flow_threshold=0.4,
    )
    return masks.astype(np.int32)


def sensitivity_to_otsu_scale(sensitivity: float) -> float:
    """Map the 0-100 UI 'sensitivity' knob to an Otsu-threshold multiplier 1.4..0.6.

    High sensitivity -> lower threshold -> more (dimmer) cells accepted.
    """
    s = float(np.clip(sensitivity, 0, 100))
    return 1.4 - 0.8 * s / 100.0


def segment_otsu(
    nuclei: np.ndarray,
    membrane: np.ndarray | None,
    diameter: float,
    sensitivity: float = 50,
) -> np.ndarray:
    """Classic thresholding on the nuclei channel: Otsu + distance-transform
    watershed to split touching nuclei. No model, no GPU. Returns int32 labels
    with the same contract as segment() (count == labels.max()).

    membrane is unused; accepted for signature parity with segment().
    """
    from scipy import ndimage as ndi
    from skimage import feature, filters, morphology, segmentation

    del membrane
    img = nuclei.astype(np.float32)
    smoothed = filters.gaussian(img, sigma=max(1.0, diameter / 20.0))
    if smoothed.max() == smoothed.min():
        return np.zeros(img.shape, dtype=np.int32)
    mask = smoothed > filters.threshold_otsu(smoothed) * sensitivity_to_otsu_scale(sensitivity)
    mask = morphology.remove_small_objects(mask, max_size=int(0.15 * np.pi * (diameter / 2) ** 2))
    mask = ndi.binary_fill_holes(mask)
    if not mask.any():
        return np.zeros(img.shape, dtype=np.int32)
    dist = ndi.distance_transform_edt(mask)
    coords = feature.peak_local_max(dist, min_distance=max(3, int(diameter / 4)), labels=mask)
    peaks = np.zeros(mask.shape, dtype=bool)
    peaks[tuple(coords.T)] = True
    markers, _ = ndi.label(peaks)
    labels = segmentation.watershed(-dist, markers, mask=mask)
    return segmentation.relabel_sequential(labels)[0].astype(np.int32)
