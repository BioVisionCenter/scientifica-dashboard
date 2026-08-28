"""Segmentation backends: cellpose (AI) and Otsu (classic), same label output."""

import os
import threading
from collections.abc import Callable
from functools import lru_cache

import numpy as np

from scientifica import config
from scientifica.analysis.enhance import enhance_patch

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")


def sensitivity_to_cellprob(sensitivity: float) -> float:
    """Map the 0-100 UI 'sensitivity' knob to cellprob_threshold +3..-3.

    High sensitivity -> low threshold -> more (dimmer) cells accepted.
    """
    s = float(np.clip(sensitivity, 0, 100))
    return 3.0 - 6.0 * s / 100.0


@lru_cache(maxsize=1)
def get_model():
    """cellpose-SAM (cellpose 4). One shared model: keep CELLPOSE_WORKERS = 1."""
    from cellpose import models

    return models.CellposeModel(
        gpu=True, pretrained_model=config.CPSAM_MODEL, use_bfloat16=config.CPSAM_BF16
    )


def warmup() -> None:
    """Load the model and run a dummy inference so the first real request is fast."""
    dummy = np.zeros((128, 128), dtype=np.float32)
    segment(dummy, None, diameter=30.0, sensitivity=50)


def segment(
    nuclei: np.ndarray,
    membrane: np.ndarray | None,
    diameter: float,
    sensitivity: float = 50,
    niter: int | None = None,
) -> np.ndarray:
    """Run cellpose-SAM on the nuclei channel (grayscale; a membrane channel
    may be stacked in — cpsam takes arbitrary channel orders). Returns int32
    labels. `diameter` rescales the image so objects match cpsam's ~30 px
    training size; `niter` raises the flow-integration steps for big objects."""
    model = get_model()
    if membrane is None:
        img = nuclei.astype(np.float32)
        channel_axis = None
    else:
        img = np.stack([nuclei.astype(np.float32), membrane.astype(np.float32)])
        channel_axis = 0
    masks, _, _ = model.eval(
        img,
        channel_axis=channel_axis,
        diameter=diameter,
        cellprob_threshold=sensitivity_to_cellprob(sensitivity),
        flow_threshold=config.SEG_FLOW_THRESHOLD,
        niter=niter,
        normalize=True,
    )
    return np.asarray(masks).astype(np.int32)


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


class JobCancelled(Exception):
    """Raised inside a tile function when the job's cancel event is set."""


def workers_for(segmenter: str) -> int:
    return config.CELLPOSE_WORKERS if segmenter == "cellpose" else config.OTSU_WORKERS


def make_tile_segmenter(
    segmenter: str,
    diameter_px: float,
    sensitivity: float,
    window: tuple[float, float],
    method: str = "gaussian",
    strength: float = 1.5,
    on_tile: Callable[[], None] | None = None,
    cancel: threading.Event | None = None,
    niter: int | None = None,
) -> Callable[[np.ndarray], np.ndarray]:
    """(raw uint16 (y, x) tile) -> uint32 label tile, for ngio SegmentationIterator."""
    lo, hi = window

    def run(patch: np.ndarray) -> np.ndarray:
        if cancel is not None and cancel.is_set():
            raise JobCancelled()
        patch = np.asarray(patch).reshape(patch.shape[-2:])
        enhanced = enhance_patch(patch, lo, hi, method, strength)
        if segmenter == "cellpose":
            labels = segment(enhanced, None, diameter_px, sensitivity, niter=niter)
        else:
            labels = segment_otsu(enhanced, None, diameter_px, sensitivity)
        if on_tile is not None:
            on_tile()
        return labels.astype(np.uint32)

    return run
