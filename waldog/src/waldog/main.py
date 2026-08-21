"""Where's Waldog: hide pet cutouts in the 3-color Scientifica ROI renders.

One puzzle + solution pair per waldog ROI (roi_1, roi_7, roi_13 from
ROI_naming.xlsx), using the pngs staged by `scientifica-ingest` in
data/source/waldog/. Pets are scaled to the local cell size (manifest diameter
where available, cellpose size estimation otherwise) and only placed on tissue.
"""

import argparse
import json
import random
import subprocess
from pathlib import Path

import numpy as np
import PIL.Image as Image
import PIL.ImageDraw as ImageDraw
from scipy import ndimage

Image.MAX_IMAGE_PIXELS = None

PROJECT_DIR = Path(__file__).resolve().parents[2]
REPO_DIR = PROJECT_DIR.parent
DEFAULT_SOURCE_DIR = REPO_DIR / "data" / "source" / "waldog"
MANIFEST_PATH = REPO_DIR / "data" / "derived" / "manifest.json"
PETS_DIR = PROJECT_DIR / "waldog-pets"
CUTOUT_DIR = PETS_DIR / "cutouts"
DEFAULT_OUT_DIR = PROJECT_DIR / "output"

DEFAULT_ROIS = "1,7,13"

# --- Difficulty knobs (defaults = Medium) ---
PET_CELL_RANGE = (0.9, 1.3)  # pet size as a multiple of the local cell diameter
PET_ALPHA = 0.90  # overall opacity of the pets; lower = harder
COLOR_BLEND = 0.2  # 0..1 how much to pull pet colors toward local background
MAX_PLACEMENT_TRIES = 2000  # attempts to find a free, on-tissue spot per pet
TISSUE_COVERAGE = 0.95  # fraction of a pet's opaque pixels that must be on tissue

# rembg model per pet photo stem; unlisted photos use rembg's default. The cat
# and the black dog keep furniture with the default model; birefnet removes the
# cat's couch+pillow completely (verified visually).
REMBG_MODELS = {
    "41789": "birefnet-general",
    "137fb4d5-fe6d-4bdb-99fc-f0aa8ec113b5": "birefnet-general",
}

# Keep only the top fraction of these cutouts (feathered): the black dog drapes
# over a black chair no model can separate, but its head-and-shoulders crop is
# clean.
CUTOUT_TOP_CROP = {
    "137fb4d5-fe6d-4bdb-99fc-f0aa8ec113b5": 0.55,
}

# Black-border autocrop (mirrors scientifica.analysis.io, copied to keep
# waldog free of the dashboard's heavy dependencies)
CROP_THRESHOLD = 15
CROP_MARGIN = 16


def _largest_run(condition: np.ndarray, max_gap: int = 32) -> np.ndarray:
    idx = np.flatnonzero(condition)
    if len(idx) == 0:
        return idx
    breaks = np.flatnonzero(np.diff(idx) > max_gap)
    starts = np.concatenate(([0], breaks + 1))
    ends = np.concatenate((breaks, [len(idx) - 1]))
    best = np.argmax(idx[ends] - idx[starts])
    return idx[starts[best] : ends[best] + 1]


def autocrop_bbox(rgb: np.ndarray) -> tuple[int, int, int, int]:
    """Bounding box (x0, y0, x1, y1) of non-black content, with margin."""
    mask = rgb.sum(axis=2) > CROP_THRESHOLD
    rows = _largest_run(mask.mean(axis=1) > 0.002)
    cols = _largest_run(mask.mean(axis=0) > 0.002)
    if len(rows) == 0:
        return 0, 0, rgb.shape[1], rgb.shape[0]
    m = CROP_MARGIN
    y0 = max(0, int(rows[0]) - m)
    y1 = min(rgb.shape[0], int(rows[-1]) + 1 + m)
    x0 = max(0, int(cols[0]) - m)
    x1 = min(rgb.shape[1], int(cols[-1]) + 1 + m)
    return x0, y0, x1, y1


def load_base(png_path: Path) -> np.ndarray:
    """3-color ROI render -> float01 RGB, black padding cropped, landscape."""
    img = Image.open(png_path)
    if img.mode != "RGB":
        img = img.convert("RGB")
    rgb = np.asarray(img)
    x0, y0, x1, y1 = autocrop_bbox(rgb)
    rgb = rgb[y0:y1, x0:x1]
    if rgb.shape[0] > rgb.shape[1]:
        rgb = np.rot90(rgb, k=-1)
    return rgb.astype(np.float32) / 255.0


def cell_diameter(roi_n: int, base: np.ndarray, source_dir: Path) -> float:
    """Cell diameter in png space: cached -> manifest -> cellpose estimate."""
    cache_path = source_dir / "cell_sizes.json"
    cache = json.loads(cache_path.read_text()) if cache_path.exists() else {}
    key = f"roi_{roi_n:02d}"
    if key in cache:
        return float(cache[key])

    width = base.shape[1]
    diam = None
    if MANIFEST_PATH.exists():
        entries = {i["id"]: i for i in json.loads(MANIFEST_PATH.read_text())["images"]}
        e = entries.get(key)
        if e and e.get("diameter_px"):
            diam = e["diameter_px"] * width / e["width"]
            print(f"[roi_{roi_n}] cell diameter from manifest: {diam:.0f}px")

    if diam is None:
        try:
            from cellpose import models
        except ImportError as exc:  # pragma: no cover
            raise SystemExit(
                f"{key} is not in the dashboard manifest and cellpose is not "
                "installed — run inside the scientifica venv (uv run waldog) "
                "or pass --cell-size"
            ) from exc
        print(f"[roi_{roi_n}] estimating cell diameter with cellpose...")
        scale = 2048 / width
        h, w = base.shape[:2]
        small = Image.fromarray((base * 255).astype(np.uint8)).resize(
            (round(w * scale), round(h * scale)), Image.LANCZOS
        )
        gray = np.asarray(small.convert("L"))
        size_model = models.Cellpose(model_type="cyto3", gpu=True)
        est, _ = size_model.sz.eval(gray, channels=[0, 0])
        diam = float(est) / scale
        print(f"[roi_{roi_n}] cellpose estimate: {diam:.0f}px")

    cache[key] = round(diam, 1)
    cache_path.write_text(json.dumps(cache, indent=1))
    return diam


def tissue_mask(base: np.ndarray, cell_diam: float) -> np.ndarray:
    """Boolean full-res mask of tissue: bright content with inter-cell gaps
    closed at the cell scale, so real background holes stay excluded."""
    ds = 4
    gray = base[::ds, ::ds].max(axis=2)
    # 0.15 keeps actual cells but rejects the dim out-of-focus haze near the
    # sample edges, so pets never sit in the glow next to true background
    mask = gray > 0.15
    r = max(2, round(cell_diam / 2 / ds))
    yy, xx = np.ogrid[-r : r + 1, -r : r + 1]
    disk = (yy * yy + xx * xx) <= r * r
    mask = ndimage.binary_closing(mask, structure=disk)
    return np.kron(mask, np.ones((ds, ds), dtype=bool))[: base.shape[0], : base.shape[1]]


def hex_to_rgb(hex_color: str) -> np.ndarray:
    """Convert a 6-char hex color (no '#') to an RGB float array in [0, 1]."""
    hex_color = hex_color.lstrip("#")
    return np.array(
        [int(hex_color[j : j + 2], 16) for j in (0, 2, 4)], dtype=np.float32
    ) / 255.0


def get_cutout(src: Path) -> Path:
    """Remove the background of a pet photo with rembg (cached on disk)."""
    dst = CUTOUT_DIR / f"{src.stem}.png"
    if dst.exists():
        return dst
    print(f"Removing background of {src.name} (first run downloads the model)...")
    model_args = ["-m", REMBG_MODELS[src.stem]] if src.stem in REMBG_MODELS else []
    subprocess.run(
        # onnxruntime has no free-threaded wheels yet, so pin a regular Python.
        ["uv", "tool", "run", "--python", "3.12", "--from", "rembg[cpu,cli]",
         "rembg", "i", *model_args, str(src), str(dst)],
        check=True,
    )
    return dst


def _clean_alpha(arr: np.ndarray) -> np.ndarray:
    """Cut thin bridges (a paw touching a couch) with a binary opening, then
    keep only the largest connected blob of the alpha mask."""
    alpha = arr[..., 3]
    solid = alpha > 64
    if not solid.any():
        return arr
    r = max(3, round(0.004 * max(arr.shape[:2])))
    yy, xx = np.ogrid[-r : r + 1, -r : r + 1]
    disk = (yy * yy + xx * xx) <= r * r
    opened = ndimage.binary_opening(solid, structure=disk)
    if not opened.any():
        opened = solid
    labels, n = ndimage.label(opened)
    if n > 1:
        sizes = ndimage.sum_labels(np.ones_like(labels), labels, range(1, n + 1))
        opened = labels == (np.argmax(sizes) + 1)
    # regrow slightly so the pet keeps its soft edge, but never past the
    # original mask (the couch stays gone)
    keep = ndimage.binary_dilation(opened, structure=disk) & (alpha > 25)
    arr = arr.copy()
    arr[..., 3] *= keep
    return arr


def load_pet(cutout: Path, size_px: int) -> tuple[np.ndarray, np.ndarray]:
    """Load an RGBA cutout, clean its mask, crop to the subject and scale it so
    its OPAQUE area is roughly size_px**2 (bbox area would let leftover
    background junk shrink the animal)."""
    pet = Image.open(cutout).convert("RGBA")
    arr = _clean_alpha(np.array(pet))
    pet = Image.fromarray(arr)

    bbox = pet.getchannel("A").getbbox()
    assert bbox is not None, f"Cutout {cutout.name} is fully transparent"
    pet = pet.crop(bbox)

    frac = CUTOUT_TOP_CROP.get(cutout.stem)
    if frac is not None:
        keep_h = round(pet.height * frac)
        arr = np.array(pet.crop((0, 0, pet.width, keep_h)))
        feather = max(1, round(keep_h * 0.12))
        ramp = np.linspace(1, 0, feather)[:, None]
        arr[-feather:, :, 3] = (arr[-feather:, :, 3] * ramp).astype(np.uint8)
        pet = Image.fromarray(arr).crop(Image.fromarray(arr).getchannel("A").getbbox())
    opaque = (np.asarray(pet)[..., 3] > 128).sum()
    scale = size_px / max(1.0, opaque) ** 0.5
    pet = pet.resize(
        (max(round(pet.width * scale), 1), max(round(pet.height * scale), 1)),
        Image.LANCZOS,
    )
    arr = np.array(pet, dtype=np.float32) / 255.0
    return arr[..., :3], arr[..., 3]


def make_puzzle(base: np.ndarray, pet_photos: list[Path], cell_diam: float,
                out_path: Path, solution_path: Path) -> None:
    """Hide every pet in `base` (float01 RGB, modified in place) and write the pair."""
    height, width = base.shape[:2]
    tissue = tissue_mask(base, cell_diam)

    placements: list[tuple[str, int, int, int, int]] = []
    for photo in pet_photos:
        size = round(cell_diam * random.uniform(*PET_CELL_RANGE))
        pet_rgb, pet_a = load_pet(get_cutout(photo), size)
        dh, dw = pet_a.shape
        opaque = pet_a > 0.5

        spot = None
        coverage = TISSUE_COVERAGE
        for attempt in range(MAX_PLACEMENT_TRIES):
            if attempt == MAX_PLACEMENT_TRIES // 2 and coverage == TISSUE_COVERAGE:
                coverage = 0.85
                print(f"  warning: relaxing tissue coverage to {coverage} for {photo.stem}")
            y0 = random.randint(0, height - dh)
            x0 = random.randint(0, width - dw)
            margin = 10
            if not all(
                y0 + dh + margin <= py or py + ph + margin <= y0
                or x0 + dw + margin <= px or px + pw + margin <= x0
                for _, py, px, ph, pw in placements
            ):
                continue
            if tissue[y0 : y0 + dh, x0 : x0 + dw][opaque].mean() < coverage:
                continue
            spot = (y0, x0)
            break
        assert spot is not None, f"Could not find a free on-tissue spot for {photo.stem}"
        y0, x0 = spot

        bg = base[y0 : y0 + dh, x0 : x0 + dw]

        # Pull the pet's colors toward the local background so it blends in.
        pet_rgb = (1.0 - COLOR_BLEND) * pet_rgb + COLOR_BLEND * bg

        # Alpha-composite the faint pet onto the base.
        alpha = (pet_a * PET_ALPHA)[..., None]
        base[y0 : y0 + dh, x0 : x0 + dw] = (1.0 - alpha) * bg + alpha * pet_rgb
        placements.append((photo.stem, y0, x0, dh, dw))

    out = (base * 255.0).clip(0, 255).astype(np.uint8)
    Image.fromarray(out).save(out_path)

    # Solution image: same picture with a circle around each hidden pet
    solution = Image.fromarray(out)
    draw = ImageDraw.Draw(solution)
    for name, y0, x0, dh, dw in placements:
        cy, cx = y0 + dh / 2, x0 + dw / 2
        radius = max(60.0, max(dh, dw) * 0.9)
        draw.ellipse(
            (cx - radius, cy - radius, cx + radius, cy + radius),
            outline=(255, 0, 0),
            width=max(round(radius / 25), 3),
        )
        print(f"  hid {name} at (y={y0}, x={x0})")
    solution.save(solution_path)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        type=Path,
        default=DEFAULT_SOURCE_DIR,
        help="Directory with the 3-color ROI pngs (default: data/source/waldog)",
    )
    parser.add_argument(
        "--rois",
        default=DEFAULT_ROIS,
        help=f"Comma-separated ROI numbers to render (default: {DEFAULT_ROIS})",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=DEFAULT_OUT_DIR,
        help="Directory for the puzzle and solution PNGs (default: waldog/output)",
    )
    parser.add_argument(
        "--seed", type=int, default=None,
        help="Random seed for reproducible placement",
    )
    parser.add_argument(
        "--cell-size", type=float, default=None,
        help="Override the cell diameter (px in print space) instead of measuring it",
    )
    args = parser.parse_args()

    rois = [int(x) for x in args.rois.split(",")]
    out_dir: Path = args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    CUTOUT_DIR.mkdir(exist_ok=True)
    pet_photos = sorted(
        p for p in PETS_DIR.iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png"}
    )
    assert pet_photos, f"No pet images found in {PETS_DIR}"

    for i, n in enumerate(rois):
        png = args.source / f"roi_{n:02d}.png"
        assert png.exists(), f"{png} not found (run scientifica-ingest first)"
        print(f"[roi_{n}] loading {png.name}...")
        base = load_base(png)
        diam = args.cell_size or cell_diameter(n, base, args.source)
        print(f"[roi_{n}] pets sized to ~{diam:.0f}px (local cell diameter)")

        # per-ROI seed so each puzzle is reproducible on its own
        random.seed(args.seed + i if args.seed is not None else None)

        out_path = out_dir / f"wheres_waldog_roi_{n}.png"
        solution_path = out_dir / f"wheres_waldog_roi_{n}_solution.png"
        make_puzzle(base, pet_photos, diam, out_path, solution_path)
        print(f"[roi_{n}] find all {len(pet_photos)} pets in {out_path.name} "
              f"(answer key: {solution_path.name})")


if __name__ == "__main__":
    main()
