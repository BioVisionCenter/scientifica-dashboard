"""Crop counting-game patches with ground-truth counts from the segmentation.

Counts use the centroid-in-window rule (unambiguous for border cells).
Run after the main pipeline: uv run scientifica-patches
"""

import argparse
import json

import numpy as np
from PIL import Image

from scientifica import config

# (target_count, window_px at working res). Windows sized for 2048-res fields.
TARGETS = [25, 40, 60, 80, 110, 150, 200]
WINDOW = 760
STRIDE = 190
BOSS_WINDOW = 1400  # on the 4096 hero -> hundreds of cells


def candidate_windows(centroids: np.ndarray, shape: tuple[int, int], window: int, stride: int):
    """Yield (x0, y0, count) for every window position."""
    h, w = shape
    xs = centroids[:, 0]
    ys = centroids[:, 1]
    for y0 in range(0, max(1, h - window + 1), stride):
        for x0 in range(0, max(1, w - window + 1), stride):
            count = int(
                np.count_nonzero(
                    (xs >= x0) & (xs < x0 + window) & (ys >= y0) & (ys < y0 + window)
                )
            )
            yield x0, y0, count


def load_centroids(image_id: str) -> np.ndarray:
    with open(config.DERIVED_DIR / image_id / "features.json") as f:
        cells = json.load(f)["cells"]
    if not cells:
        return np.zeros((0, 2), dtype=np.float32)
    return np.array([c["centroid"] for c in cells], dtype=np.float32)


def pick_patches(manifest: dict) -> list[dict]:
    fields = [img for img in manifest["images"] if not img["hero"]]
    heroes = [img for img in manifest["images"] if img["hero"]]

    # Gather candidates from every field
    all_candidates = []
    for img in fields:
        centroids = load_centroids(img["id"])
        for x0, y0, count in candidate_windows(
            centroids, (img["height"], img["width"]), WINDOW, STRIDE
        ):
            if count >= 15:
                all_candidates.append({"img": img, "x0": x0, "y0": y0, "count": count, "window": WINDOW})

    # Greedy: for each target count, best unused candidate (prefer spreading sources)
    chosen: list[dict] = []
    used_sources: dict[str, int] = {}

    def overlaps(c) -> bool:
        for p in chosen:
            if p["img"]["id"] != c["img"]["id"]:
                continue
            if abs(p["x0"] - c["x0"]) < c["window"] and abs(p["y0"] - c["y0"]) < c["window"]:
                return True
        return False

    for target in TARGETS:
        best = None
        best_key = None
        for c in all_candidates:
            if overlaps(c):
                continue
            key = (abs(c["count"] - target), used_sources.get(c["img"]["id"], 0))
            if best is None or key < best_key:
                best, best_key = c, key
        if best is not None:
            chosen.append(best)
            used_sources[best["img"]["id"]] = used_sources.get(best["img"]["id"], 0) + 1

    # Boss round from the hero overview
    for img in heroes:
        centroids = load_centroids(img["id"])
        best = None
        for x0, y0, count in candidate_windows(
            centroids, (img["height"], img["width"]), BOSS_WINDOW, BOSS_WINDOW // 4
        ):
            if best is None or count > best[2]:
                best = (x0, y0, count)
        if best and best[2] >= 100:
            chosen.append({"img": img, "x0": best[0], "y0": best[1], "count": best[2], "window": BOSS_WINDOW, "boss": True})

    return chosen


def export(chosen: list[dict]) -> None:
    config.GAME_DIR.mkdir(parents=True, exist_ok=True)
    records = []
    chosen = sorted(chosen, key=lambda c: c["count"])
    for i, c in enumerate(chosen):
        img = c["img"]
        patch_id = f"patch_{i:02d}"
        raw = Image.open(config.DERIVED_DIR / img["id"] / "enhanced.jpg")
        crop = raw.crop((c["x0"], c["y0"], c["x0"] + c["window"], c["y0"] + c["window"]))
        if c["window"] > 1000:  # boss patch: keep the served file lean
            crop = crop.resize((1000, 1000), Image.Resampling.LANCZOS)
        path = config.GAME_DIR / f"{patch_id}.jpg"
        crop.save(path, quality=92)
        records.append(
            {
                "id": patch_id,
                "image": f"/assets/game/{patch_id}.jpg",
                "source_roi": img["id"],
                "boss": bool(c.get("boss")),
                "true_count": c["count"],
            }
        )
        print(f"{patch_id}: {c['count']} cells from {img['id']} @({c['x0']},{c['y0']}) w={c['window']}")

    with open(config.GAME_MANIFEST_PATH, "w") as f:
        json.dump(records, f, indent=1)
    print(f"game manifest written: {len(records)} patches")


def main() -> None:
    argparse.ArgumentParser().parse_args()
    with open(config.MANIFEST_PATH) as f:
        manifest = json.load(f)
    export(pick_patches(manifest))


if __name__ == "__main__":
    main()
