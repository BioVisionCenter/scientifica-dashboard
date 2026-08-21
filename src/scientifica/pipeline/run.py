"""Offline pipeline: raw composites -> derived web assets + manifest.

Usage: uv run scientifica-pipeline [--only 0,5] [--diameter 42] [--segmenter cellpose|otsu]
"""

import argparse
import json
import re
import time
from datetime import datetime, timezone

import numpy as np
from PIL import Image

from scientifica import config
from scientifica.analysis import channels, enhance, measure, render, segment
from scientifica.analysis.io import load_working_image


def discover_raw() -> list[tuple[str, "config.Path"]]:
    items = []
    for path in sorted(config.RAW_DIR.glob("scientifica_roi_*.png")):
        idx = int(re.search(r"_(\d+)\.png$", path.name).group(1))
        items.append((f"roi_{idx:02d}", idx, path))
    items.sort(key=lambda t: t[1])
    return [(rid, path) for rid, _, path in items]


def process_image(image_id: str, path, diameter: float | None, segmenter: str = "cellpose") -> dict:
    t0 = time.time()
    is_hero = f"roi_{int(image_id.split('_')[1])}" in config.HERO_IDS
    long_side = config.HERO_LONG_SIDE if is_hero else config.WORKING_LONG_SIDE
    loaded = load_working_image(path, long_side)
    rgb = loaded.rgb
    h, w = rgb.shape[:2]
    print(f"[{image_id}] loaded {w}x{h} (scale {loaded.scale_from_raw:.3f})")

    nuclei, membrane = channels.split_channels(rgb)

    out_dir = config.DERIVED_DIR / image_id
    out_dir.mkdir(parents=True, exist_ok=True)

    # Display assets: raw look + default-enhanced look
    Image.fromarray(rgb).save(out_dir / "raw.jpg", quality=90)
    d = config.DEFAULTS
    enh_n = enhance.enhance_channel(nuclei, d["denoise"]["method"], d["denoise"]["strength"], *d["stretch"])
    enh_m = enhance.enhance_channel(membrane, d["denoise"]["method"], d["denoise"]["strength"], *d["stretch"])
    enhanced_rgb = channels.composite(enh_n, enh_m, config.NUCLEI_HEX, config.MEMBRANE_HEX)
    Image.fromarray(enhanced_rgb).save(out_dir / "enhanced.jpg", quality=90)

    # Segment on the enhanced channels (cleaner input, same params story)
    if diameter is None:
        print(f"[{image_id}] estimating diameter...")
        diameter = segment.estimate_diameter(enh_n, enh_m)
        print(f"[{image_id}] estimated diameter: {diameter:.1f}px")
    seg_fn = segment.segment if segmenter == "cellpose" else segment.segment_otsu
    labels = seg_fn(enh_n, enh_m, diameter=diameter, sensitivity=50)
    n_cells = int(labels.max())
    print(f"[{image_id}] segmented: {n_cells} cells ({time.time() - t0:.0f}s)")

    render.encode_labels_rgb(labels).save(out_dir / "labels_rgb.png", optimize=True)
    render.render_outlines(labels).save(out_dir / "outlines.png", optimize=True)
    render.render_mask(labels).save(out_dir / "mask.png", optimize=True)
    np.save(out_dir / "labels.npy", labels)

    cells = measure.measure_cells(labels, nuclei, membrane)
    with open(out_dir / "features.json", "w") as f:
        json.dump({"features": measure.FEATURE_KEYS, "cells": cells}, f)

    return {
        "id": image_id,
        "title": "Tissue overview" if is_hero else f"Field {int(image_id.split('_')[1]) + 1}",
        "width": w,
        "height": h,
        "hero": is_hero,
        "scale_from_raw": round(loaded.scale_from_raw, 5),
        "crop_offset_raw": list(loaded.crop_offset_raw),
        "cell_count": n_cells,
        "diameter_px": round(diameter, 1),
        "assets": {
            "raw": f"/assets/{image_id}/raw.jpg",
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
    parser.add_argument("--diameter", type=float, default=None, help="skip auto-estimation")
    parser.add_argument("--segmenter", choices=["cellpose", "otsu"], default="cellpose")
    args = parser.parse_args()

    items = discover_raw()
    if args.only:
        wanted = {int(x) for x in args.only.split(",")}
        items = [(rid, p) for rid, p in items if int(rid.split("_")[1]) in wanted]
    if not items:
        raise SystemExit("no raw images matched")

    config.DERIVED_DIR.mkdir(parents=True, exist_ok=True)

    # Merge into an existing manifest so --only runs don't drop other images
    existing: dict[str, dict] = {}
    if config.MANIFEST_PATH.exists():
        try:
            with open(config.MANIFEST_PATH) as f:
                prev = json.load(f)
            existing = {img["id"]: img for img in prev.get("images", [])}
            if args.diameter is None and prev.get("defaults", {}).get("diameter_px"):
                args.diameter = prev["defaults"]["diameter_px"]
        except json.JSONDecodeError:
            print("warning: existing manifest is corrupt, rebuilding from scratch")

    diameter = args.diameter
    if args.segmenter == "otsu" and diameter is None:
        raise SystemExit("otsu needs --diameter (auto-estimation uses cellpose)")
    for image_id, path in items:
        is_hero = f"roi_{int(image_id.split('_')[1])}" in config.HERO_IDS
        # hero overview is a different magnification: always estimate its own
        # diameter (cellpose only — otsu runs keep the user-given diameter)
        estimate_hero = is_hero and args.segmenter == "cellpose"
        entry = process_image(image_id, path, None if estimate_hero else diameter, args.segmenter)
        if diameter is None and not is_hero:
            diameter = entry["diameter_px"]  # estimate once, pin for the rest
        existing[image_id] = entry

    defaults = dict(config.DEFAULTS)
    defaults["diameter_px"] = diameter
    manifest = {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "defaults": defaults,
        "images": sorted(existing.values(), key=lambda e: e["id"]),
    }
    with open(config.MANIFEST_PATH, "w") as f:
        json.dump(manifest, f, indent=1)
    print(f"manifest written: {len(existing)} images, default diameter {diameter:.1f}px")


if __name__ == "__main__":
    main()
