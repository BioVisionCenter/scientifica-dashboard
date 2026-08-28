"""Offline pipeline: napari pngs + raw tiffs -> derived web assets + manifest.

Per ROI it derives: display.jpg (napari render, game/TV), per-channel grayscale
PNGs for the client-side blending viewer, an enhanced composite, segmentation
assets from the curated nuclei labels, per-cell features, and a timed cellpose
benchmark (the labels themselves stay curated; only the seconds are kept).

Usage: uv run scientifica-pipeline [--only 0,5] [--skip-benchmark]
"""

import argparse
import json
import time
from datetime import datetime, timezone

import numpy as np
from PIL import Image

from scientifica import config
from scientifica.analysis import channels, enhance, measure, render
from scientifica.analysis.io import load_channel_tiff, load_display_png, load_labels_tiff


def discover() -> list[tuple[str, "config.Path", "config.Path"]]:
    """(image_id, napari_png, raw_dir) for every dashboard ROI."""
    items = []
    for png in sorted(config.NAPARI_DIR.glob("roi_*.png")):
        image_id = png.stem
        raw_dir = config.RAW_TIFF_DIR / image_id
        if not raw_dir.is_dir():
            raise SystemExit(f"{image_id}: no raw tiffs in {raw_dir} (run scientifica-ingest)")
        items.append((image_id, png, raw_dir))
    return items


def process_image(image_id: str, png_path, raw_dir, skip_benchmark: bool, prev: dict | None) -> dict:
    t0 = time.time()
    is_hero = f"roi_{int(image_id.split('_')[1])}" in config.HERO_IDS
    long_side = config.HERO_LONG_SIDE if is_hero else config.WORKING_LONG_SIDE
    out_dir = config.DERIVED_DIR / image_id
    out_dir.mkdir(parents=True, exist_ok=True)

    # Display asset: the napari render, landscape, TV-sized
    display = load_display_png(png_path, config.DISPLAY_LONG_SIDE)
    Image.fromarray(display).save(out_dir / "display.jpg", quality=90)

    # Channels: every tiff except the labels, landscape at working size
    chans: dict[str, np.ndarray] = {}
    ranges: dict[str, tuple[int, int]] = {}
    rotated = False
    for key in config.CHANNEL_DEFS:
        path = raw_dir / f"{key}.tiff"
        if not path.exists():
            continue
        chans[key], rotated, ranges[key] = load_channel_tiff(path, long_side)
        Image.fromarray(chans[key]).save(out_dir / f"chan_{key}.png", optimize=True)
    if "dapi" not in chans or "lamin_b1" not in chans:
        raise SystemExit(f"{image_id}: missing dapi/lamin_b1 tiff in {raw_dir}")
    h, w = chans["dapi"].shape
    print(f"[{image_id}] channels {sorted(chans)} {w}x{h}{' (rotated)' if rotated else ''}")

    # Enhanced composite, pixel-registered with the channels
    d = config.DEFAULTS
    enhanced = {
        key: enhance.enhance_channel(chan, d["denoise"]["method"], d["denoise"]["strength"], *d["stretch"])
        for key, chan in chans.items()
    }
    enhanced_rgb = channels.composite(
        [(enhanced[key], config.CHANNEL_DEFS[key][1]) for key in enhanced]
    )
    Image.fromarray(enhanced_rgb).save(out_dir / "enhanced.jpg", quality=90)

    # Segmentation assets from the curated labels
    labels = load_labels_tiff(raw_dir / "nuclei.tiff", (h, w), rotated)
    n_cells = int(labels.max())
    render.encode_labels_rgb(labels).save(out_dir / "labels_rgb.png", optimize=True)
    np.save(out_dir / "labels.npy", labels)

    # Overlays only: trace the boundaries on a label map close to the source
    # resolution, then downscale the rendered RGBA. On the hero that turns a 5x
    # NEAREST collapse into thin antialiased rings instead of a yellow mesh.
    ss = config.OVERLAY_SUPERSAMPLE
    ov = labels if ss == 1 else load_labels_tiff(raw_dir / "nuclei.tiff", (h * ss, w * ss), rotated)
    render.downscale_rgba(render.render_outlines(ov), (w, h)).save(
        out_dir / "outlines.png", optimize=True
    )
    render.downscale_rgba(render.render_mask(ov), (w, h)).save(
        out_dir / "mask.png", optimize=True
    )
    del ov

    cells = measure.measure_cells(labels, chans["dapi"], chans["lamin_b1"])
    with open(out_dir / "features.json", "w") as f:
        json.dump({"features": measure.FEATURE_KEYS, "cells": cells}, f)
    diameter = round(float(np.median([c["equivalent_diameter"] for c in cells])), 1) if cells else None
    print(f"[{image_id}] {n_cells} cells, median diameter {diameter}px ({time.time() - t0:.0f}s)")

    # Timed cellpose run — result discarded, only the wall time is displayed
    # on the TV idle slides ("found N cells — in X s").
    if skip_benchmark:
        cellpose_seconds = (prev or {}).get("cellpose_seconds")
    else:
        from scientifica.analysis import segment

        tb = time.time()
        segment.segment(enhanced["dapi"], None, diameter=diameter or 30.0, sensitivity=50)
        cellpose_seconds = round(time.time() - tb, 1)
        print(f"[{image_id}] cellpose benchmark: {cellpose_seconds}s")

    return {
        "id": image_id,
        "title": config.ROI_NAMES.get(image_id, image_id),
        "width": w,
        "height": h,
        "hero": is_hero,
        "rotated": rotated,
        "cell_count": n_cells,
        "diameter_px": diameter,
        "cellpose_seconds": cellpose_seconds,
        "channels": [
            {
                "key": key,
                "label": config.CHANNEL_DEFS[key][0],
                "color": config.CHANNEL_DEFS[key][1],
                "url": f"/assets/{image_id}/chan_{key}.png",
                "raw_range": list(ranges[key]),
            }
            for key in chans
        ],
        "assets": {
            "display": f"/assets/{image_id}/display.jpg",
            "enhanced": f"/assets/{image_id}/enhanced.jpg",
            "outlines": f"/assets/{image_id}/outlines.png",
            "mask": f"/assets/{image_id}/mask.png",
            "labels": f"/assets/{image_id}/labels_rgb.png",
        },
        "features_url": f"/assets/{image_id}/features.json",
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", help="comma-separated roi indices, e.g. 0,5")
    parser.add_argument(
        "--skip-benchmark",
        action="store_true",
        help="keep the previous cellpose_seconds instead of re-timing",
    )
    args = parser.parse_args()

    items = discover()
    if args.only:
        wanted = {int(x) for x in args.only.split(",")}
        items = [it for it in items if int(it[0].split("_")[1]) in wanted]
    if not items:
        raise SystemExit("no source images matched")

    config.DERIVED_DIR.mkdir(parents=True, exist_ok=True)

    # Merge into an existing manifest so --only runs don't drop other images
    existing: dict[str, dict] = {}
    if config.MANIFEST_PATH.exists():
        try:
            with open(config.MANIFEST_PATH) as f:
                existing = {img["id"]: img for img in json.load(f).get("images", [])}
        except json.JSONDecodeError:
            print("warning: existing manifest is corrupt, rebuilding from scratch")

    for image_id, png, raw_dir in items:
        existing[image_id] = process_image(
            image_id, png, raw_dir, args.skip_benchmark, existing.get(image_id)
        )

    defaults = dict(config.DEFAULTS)
    diameters = [e["diameter_px"] for e in existing.values() if not e["hero"] and e["diameter_px"]]
    defaults["diameter_px"] = round(float(np.median(diameters)), 1) if diameters else 30.0
    manifest = {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "defaults": defaults,
        "images": sorted(existing.values(), key=lambda e: e["id"]),
    }
    with open(config.MANIFEST_PATH, "w") as f:
        json.dump(manifest, f, indent=1)
    print(f"manifest written: {len(existing)} images, default diameter {defaults['diameter_px']}px")


if __name__ == "__main__":
    main()
