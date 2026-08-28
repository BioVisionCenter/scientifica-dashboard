"""Poster rendering from the whole-well pyramid (TV idle show / game images)."""

import numpy as np
from ngio import OmeZarrContainer
from PIL import Image

Image.MAX_IMAGE_PIXELS = None


def poster_level(ome: OmeZarrContainer, box_w: int, box_h: int, long_side: int) -> int:
    """Coarsest pyramid level at which the bbox long side is still >= long_side."""
    level = 0
    for lvl in range(ome.levels):
        if max(box_w, box_h) / (2**lvl) >= long_side:
            level = lvl
    return level


def poster_from_pyramid(ome: OmeZarrContainer, box, long_side: int) -> tuple[np.ndarray, int]:
    """(RGB composite of the bbox at a coarse level resized to long_side, level).

    Uses the store's omero windows and colours, and only the channels the
    omero metadata marks `active` — the same look as the viewer's defaults.
    """
    from scientifica.analysis import channels as ch_mod

    level = poster_level(ome, box.width, box.height, long_side)
    image = ome.get_image(path=str(level))
    f = 2**level
    arr = image.get_as_numpy(
        axes_order=["c", "y", "x"],
        x=slice(box.x // f, -(-box.x1 // f)),
        y=slice(box.y // f, -(-box.y1 // f)),
    )
    arr = np.asarray(arr).reshape(-1, *arr.shape[-2:])
    pairs = []
    for i, ch in enumerate(image.channels_meta.channels):
        vis = ch.channel_visualisation
        if not vis.active:
            continue
        v = np.clip((arr[i].astype(np.float32) - vis.start) / max(1.0, vis.end - vis.start), 0, 1)
        pairs.append((v, "#" + str(vis.color).lstrip("#")))
    rgb = ch_mod.composite(pairs)
    h, w = rgb.shape[:2]
    scale = min(1.0, long_side / max(w, h))
    out = Image.fromarray(rgb)
    if scale < 1.0:
        out = out.resize((round(w * scale), round(h * scale)), Image.Resampling.LANCZOS)
    return np.asarray(out), level


def label_crop_at_level(ome: OmeZarrContainer, label_name: str, box, level: int) -> np.ndarray:
    """(y, x) int64 crop of a label at a pyramid level, matching poster_from_pyramid."""
    lab = ome.get_label(label_name, path=str(level))
    f = 2**level
    arr = lab.get_as_numpy(
        axes_order=["y", "x"],
        x=slice(box.x // f, -(-box.x1 // f)),
        y=slice(box.y // f, -(-box.y1 // f)),
    )
    return np.asarray(arr).reshape(arr.shape[-2:]).astype(np.int64)
