"""Where's Waldog: hide pet cutouts in the 3-color Scientifica ROI renders.

Three modes:
  waldog                       random placement (one puzzle+solution per ROI)
  waldog propose               render candidate spots per pet for visual review
  waldog render --plan f.json  render a print from a curated placement plan

Pets are scaled to the local cell size (dashboard manifest diameter, or
--cell-size). Random mode only places on tissue; plans
say exactly where each pet goes and how it looks (alpha, blend, flip, rotation,
size tweak).
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
REVIEW_DIR = PROJECT_DIR / "review"
PLANS_DIR = PROJECT_DIR / "plans"

DEFAULT_ROIS = "1,7,13"

# --- Difficulty knobs (defaults = Medium; plans override per pet) ---
PET_CELL_RANGE = (0.9, 1.3)  # pet size as a multiple of the local cell diameter
PET_ALPHA = 0.90  # overall opacity of the pets; lower = harder
COLOR_BLEND = 0.2  # 0..1 how much to pull pet colors toward local background
MAX_PLACEMENT_TRIES = 2000  # attempts to find a free, on-tissue spot per pet
TISSUE_COVERAGE = 0.95  # fraction of a pet's opaque pixels that must be on tissue

# Guardrails for plan values so prints stay playable
PLAN_LIMITS = {
    "alpha": (0.75, 0.9),  # hard ceiling: pets never fully solid
    "color_blend": (0.0, 0.5),
    "size_mult": (0.8, 1.2),
    "rotate_deg": (-25.0, 25.0),
    "cover": (0.0, 0.6),  # "behind": fraction of the pet hidden by cells
    "saturation": (0.6, 1.6),  # vividness boost, independent of alpha
}

# Transparency is intentional per depth mode: a pet behind a cell can be near
# solid (the cell hides it); one embedded inside a cell reads as under the
# cell surface, so it is the most transparent.
MODE_DEFAULTS = {
    "top": {"alpha": 0.90, "color_blend": 0.20},
    "behind": {"alpha": 0.90, "color_blend": 0.20, "cover": 0.4},
    "inside": {"alpha": 0.86, "color_blend": 0.20},
}

# Face position per pet as a fraction (fx, fy) of the cleaned cutout,
# pre-flip/rotation. Used to keep occluding cells and the inside-clip off the
# face, and to anchor "inside" pets face-first on the host cell.
FACE_ANCHORS = {
    "cat": (0.28, 0.75),  # the tabby's head, bottom-left
    "blackdog": (0.50, 0.30),
    "chicken": (0.75, 0.20),
    "cockatiel": (0.55, 0.25),
    "spaniel": (0.50, 0.25),
}

PET_NICKNAMES = {
    "41789": "cat",
    "137fb4d5-fe6d-4bdb-99fc-f0aa8ec113b5": "blackdog",
    "9b874981-7d3e-48a2-879f-0dee4e2ff424": "chicken",
    "image": "cockatiel",
    "photo-2026-06-19": "spaniel",
}
MAP_COLORS = {  # candidate-box colors on the propose map
    "cat": (255, 60, 60),
    "blackdog": (255, 160, 40),
    "chicken": (255, 240, 60),
    "cockatiel": (80, 255, 120),
    "spaniel": (255, 80, 255),
}

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

    # the print may be rotated to landscape: compare long sides
    long_png = max(base.shape[:2])
    diam = None
    if MANIFEST_PATH.exists():
        entries = {i["id"]: i for i in json.loads(MANIFEST_PATH.read_text())["images"]}
        e = entries.get(f"roi_{roi_n}") or entries.get(key)
        if e and e.get("diameter_px"):
            bbox = e.get("bbox") or {"width": e["width"], "height": e["height"]}
            diam = e["diameter_px"] * long_png / max(bbox["width"], bbox["height"])
            print(f"[roi_{roi_n}] cell diameter from manifest: {diam:.0f}px")

    if diam is None:
        # cellpose 4 has no size model: the manifest (or --cell-size) is required
        raise SystemExit(
            f"roi_{roi_n} is not in the dashboard manifest — run the pipeline "
            "(uv run scientifica-pipeline measure) or pass --cell-size"
        )

    cache[key] = round(diam, 1)
    cache_path.write_text(json.dumps(cache, indent=1))
    return diam


def base_labels(roi_n: int, base: np.ndarray, source_dir: Path, cell_diam: float) -> np.ndarray:
    """Cellpose segmentation of the print at 2048-space (cached as .npy).

    Downscaled labels are enough for the depth modes: crops are NEAREST-
    upscaled back to full resolution where needed.
    """
    cache_path = source_dir / f"labels_roi_{roi_n}.npy"
    if cache_path.exists():
        return np.load(cache_path)
    try:
        from cellpose import models
    except ImportError as exc:  # pragma: no cover
        raise SystemExit(
            "depth modes need a cellpose segmentation — run inside the "
            "scientifica venv (uv run waldog)"
        ) from exc
    print(f"[roi_{roi_n}] segmenting the print with cellpose (one-time, cached)...")
    h, w = base.shape[:2]
    scale = 2048 / w
    small = Image.fromarray((base * 255).astype(np.uint8)).resize(
        (round(w * scale), round(h * scale)), Image.LANCZOS
    )
    gray = np.asarray(small.convert("L")).astype(np.float32)
    model = models.CellposeModel(gpu=True)  # cellpose-SAM
    masks, _, _ = model.eval(gray, diameter=cell_diam * scale)
    labels = masks.astype(np.int32)
    np.save(cache_path, labels)
    print(f"[roi_{roi_n}] segmented {labels.max()} cells -> {cache_path.name}")
    return labels


def _labels_crop(labels: np.ndarray, full_shape: tuple[int, int],
                 y0: int, x0: int, dh: int, dw: int) -> np.ndarray:
    """NEAREST-upscale the 2048-space label crop covering a full-res bbox."""
    sh = labels.shape[0] / full_shape[0]
    sw = labels.shape[1] / full_shape[1]
    ly0, lx0 = int(y0 * sh), int(x0 * sw)
    ly1 = min(labels.shape[0], int(np.ceil((y0 + dh) * sh)) + 1)
    lx1 = min(labels.shape[1], int(np.ceil((x0 + dw) * sw)) + 1)
    crop = labels[ly0:ly1, lx0:lx1]
    img = Image.fromarray(crop, mode="I").resize((dw, dh), Image.Resampling.NEAREST)
    return np.asarray(img, dtype=np.int32)


def face_point(
    stem: str, dh: int, dw: int, flip: bool, rotate_deg: float
) -> tuple[float, float]:
    """(x, y) of the pet's face inside its placed bbox, tracking flip/rotation
    (small-angle approximation: pre- and post-rotation dims treated as equal)."""
    fx, fy = FACE_ANCHORS.get(nickname(stem), (0.5, 0.3))
    if flip:
        fx = 1.0 - fx
    th = np.radians(rotate_deg)
    px, py = (fx - 0.5) * dw, (fy - 0.5) * dh
    c, s = np.cos(th), np.sin(th)
    return 0.5 * dw + px * c + py * s, 0.5 * dh - px * s + py * c


def occlusion_mask(
    labels_full: np.ndarray, pet_a: np.ndarray, cover: float,
    face_xy: tuple[float, float] | None = None,
) -> np.ndarray:
    """Float mask (pet-bbox space) of cells drawn IN FRONT of the pet.

    Occluders are picked outermost-first (centroid farthest from the pet
    center) so the periphery gets tucked behind neighbors while the face
    stays visible; selection stops once ~`cover` of the opaque pixels is
    hidden. The boundary is feathered so the front cell edge looks natural.
    """
    opaque = pet_a > 0.5
    total = opaque.sum()
    if total == 0 or cover <= 0:
        return np.zeros_like(pet_a)
    dh, dw = pet_a.shape
    cyx = np.array([dh / 2, dw / 2])
    ids, counts = np.unique(labels_full[opaque], return_counts=True)
    cand = [(i, c) for i, c in zip(ids, counts) if i != 0]
    if face_xy is not None:
        # never cover the face: drop candidates touching a disk around it
        fx, fy = face_xy
        r = 0.18 * max(dh, dw)
        yy, xx = np.ogrid[:dh, :dw]
        face_disk = (yy - fy) ** 2 + (xx - fx) ** 2 <= r * r
        cand = [(i, c) for i, c in cand if not ((labels_full == i) & face_disk).any()]
    dist = {}
    for i, _ in cand:
        ys, xs = np.nonzero(labels_full == i)
        dist[i] = np.hypot(ys.mean() - cyx[0], xs.mean() - cyx[1])
    cand.sort(key=lambda ic: dist[ic[0]], reverse=True)

    chosen: list[int] = []
    covered = 0
    budget = min(0.6, cover + 0.15) * total  # never hide more than 60%
    for i, c in cand:
        if covered / total >= cover:
            break
        if covered + c > budget:
            continue  # this cell would overshoot; try a smaller one instead
        chosen.append(i)
        covered += c
    occ = np.isin(labels_full, chosen).astype(np.float32)
    return ndimage.gaussian_filter(occ, sigma=4)


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


_CUTOUT_CACHE: dict[Path, Image.Image] = {}


def _cleaned_cutout(cutout: Path) -> Image.Image:
    """Cutout after alpha cleanup + per-pet top crop, cached (cleanup on the
    full-res cutout is the expensive part when rendering many variants)."""
    if cutout in _CUTOUT_CACHE:
        return _CUTOUT_CACHE[cutout]
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
    _CUTOUT_CACHE[cutout] = pet
    return pet


def load_pet(
    cutout: Path, size_px: int, flip: bool = False, rotate_deg: float = 0.0
) -> tuple[np.ndarray, np.ndarray]:
    """Load an RGBA cutout, clean its mask, crop to the subject, optionally
    mirror/rotate, and scale it so its OPAQUE area is roughly size_px**2 (bbox
    area would let leftover background junk shrink the animal)."""
    pet = _cleaned_cutout(cutout)

    if flip:
        pet = pet.transpose(Image.FLIP_LEFT_RIGHT)
    if rotate_deg:
        pet = pet.rotate(rotate_deg, expand=True, resample=Image.BICUBIC)
        bbox = pet.getchannel("A").getbbox()
        if bbox:
            pet = pet.crop(bbox)

    opaque = (np.asarray(pet)[..., 3] > 128).sum()
    scale = size_px / max(1.0, opaque) ** 0.5
    pet = pet.resize(
        (max(round(pet.width * scale), 1), max(round(pet.height * scale), 1)),
        Image.LANCZOS,
    )
    arr = np.array(pet, dtype=np.float32) / 255.0
    return arr[..., :3], arr[..., 3]


def _anchor(base: np.ndarray, pet_a: np.ndarray, cx: float, cy: float) -> tuple[int, int]:
    """Top-left of a center-anchored pet, clamped inside the image."""
    dh, dw = pet_a.shape
    height, width = base.shape[:2]
    x0 = max(0, min(width - dw, round(cx - dw / 2)))
    y0 = max(0, min(height - dh, round(cy - dh / 2)))
    return y0, x0


def place_pet(
    base: np.ndarray, pet_rgb: np.ndarray, pet_a: np.ndarray,
    cx: float, cy: float, alpha: float, blend: float,
    alpha_mask: np.ndarray | None = None,
    saturation: float = 1.0,
) -> tuple[int, int, int, int]:
    """Composite a pet center-anchored at (cx, cy). `alpha_mask` (pet-bbox
    space, float 0..1) carves depth: occluding cells in front, or the host
    cell's silhouette for embedded pets. Returns the placed (y0, x0, dh, dw)."""
    dh, dw = pet_a.shape
    y0, x0 = _anchor(base, pet_a, cx, cy)
    bg = base[y0 : y0 + dh, x0 : x0 + dw]
    if saturation != 1.0:
        gray = (pet_rgb @ np.array([0.299, 0.587, 0.114], dtype=np.float32))[..., None]
        pet_rgb = np.clip(gray + saturation * (pet_rgb - gray), 0.0, 1.0)
    blended = (1.0 - blend) * pet_rgb + blend * bg
    a = pet_a * alpha
    if alpha_mask is not None:
        a = a * alpha_mask
    a = a[..., None]
    base[y0 : y0 + dh, x0 : x0 + dw] = (1.0 - a) * bg + a * blended
    return y0, x0, dh, dw


def draw_solution(out_u8: np.ndarray, placements: list, solution_path: Path) -> None:
    """The rendered puzzle with a red circle around each hidden pet."""
    solution = Image.fromarray(out_u8)
    draw = ImageDraw.Draw(solution)
    for name, y0, x0, dh, dw in placements:
        cy, cx = y0 + dh / 2, x0 + dw / 2
        radius = max(60.0, max(dh, dw) * 0.9)
        draw.ellipse(
            (cx - radius, cy - radius, cx + radius, cy + radius),
            outline=(255, 0, 0),
            width=max(round(radius / 25), 8),  # stays visible on A3 prints
        )
        print(f"  hid {name} at (y={y0}, x={x0})")
    solution.save(solution_path)


def pet_photos() -> list[Path]:
    photos = sorted(
        p for p in PETS_DIR.iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png"}
    )
    assert photos, f"No pet images found in {PETS_DIR}"
    CUTOUT_DIR.mkdir(exist_ok=True)
    return photos


def nickname(stem: str) -> str:
    return PET_NICKNAMES.get(stem, stem)


def photo_for(name: str) -> Path:
    """Resolve a plan's pet reference (nickname or stem) to the photo path."""
    by_nick = {v: k for k, v in PET_NICKNAMES.items()}
    stem = by_nick.get(name, name)
    for p in pet_photos():
        if p.stem == stem:
            return p
    raise SystemExit(f"unknown pet {name!r} (known: {sorted(by_nick)})")


# ---------------------------------------------------------------- random mode


def make_puzzle(base: np.ndarray, photos: list[Path], cell_diam: float,
                out_path: Path, solution_path: Path) -> None:
    """Hide every pet at a random on-tissue spot and write the pair."""
    height, width = base.shape[:2]
    tissue = tissue_mask(base, cell_diam)

    placements: list[tuple[str, int, int, int, int]] = []
    for photo in photos:
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
        place_pet(base, pet_rgb, pet_a, x0 + dw / 2, y0 + dh / 2, PET_ALPHA, COLOR_BLEND)
        placements.append((photo.stem, y0, x0, dh, dw))

    out = (base * 255.0).clip(0, 255).astype(np.uint8)
    Image.fromarray(out).save(out_path)
    draw_solution(out, placements, solution_path)


def run_random(args: argparse.Namespace) -> None:
    args.out_dir.mkdir(parents=True, exist_ok=True)
    photos = pet_photos()
    for i, n in enumerate(parse_rois(args.rois)):
        base, diam = load_roi(n, args)
        random.seed(args.seed + i if args.seed is not None else None)
        out_path = args.out_dir / f"wheres_waldog_roi_{n}.png"
        solution_path = args.out_dir / f"wheres_waldog_roi_{n}_solution.png"
        make_puzzle(base, photos, diam, out_path, solution_path)
        print(f"[roi_{n}] find all {len(photos)} pets in {out_path.name} "
              f"(answer key: {solution_path.name})")


# --------------------------------------------------------------- propose mode


def run_propose(args: argparse.Namespace) -> None:
    photos = pet_photos()
    for i, n in enumerate(parse_rois(args.rois)):
        base, diam = load_roi(n, args)
        height, width = base.shape[:2]
        tissue = tissue_mask(base, diam)
        review = REVIEW_DIR / f"roi_{n}"
        review.mkdir(parents=True, exist_ok=True)
        random.seed(args.seed + i if args.seed is not None else None)

        manifest: dict = {"roi": n, "cell_diameter": round(diam, 1),
                          "defaults": {"alpha": PET_ALPHA, "color_blend": COLOR_BLEND},
                          "pets": {}}
        map_img = Image.fromarray((base * 255).astype(np.uint8))
        map_scale = 1400 / map_img.width
        map_img = map_img.resize((1400, round(map_img.height * map_scale)), Image.LANCZOS)
        map_draw = ImageDraw.Draw(map_img)

        for photo in photos:
            nick = nickname(photo.stem)
            pet_rgb, pet_a = load_pet(get_cutout(photo), round(diam * 1.1))
            dh, dw = pet_a.shape
            opaque = pet_a > 0.5

            candidates: list[dict] = []
            tries = 0
            while len(candidates) < args.candidates and tries < MAX_PLACEMENT_TRIES:
                tries += 1
                y0 = random.randint(0, height - dh)
                x0 = random.randint(0, width - dw)
                if tissue[y0 : y0 + dh, x0 : x0 + dw][opaque].mean() < TISSUE_COVERAGE:
                    continue
                cx, cy = x0 + dw / 2, y0 + dh / 2
                # spread candidates out so they show different neighborhoods
                if any((c["cx"] - cx) ** 2 + (c["cy"] - cy) ** 2 < (3 * diam) ** 2
                       for c in candidates):
                    continue
                cid = len(candidates)
                candidates.append({"id": cid, "cx": round(cx), "cy": round(cy)})

                # preview: composite into a local crop with ~1.5 cells of context
                m = round(1.5 * diam)
                py0, py1 = max(0, y0 - m), min(height, y0 + dh + m)
                px0, px1 = max(0, x0 - m), min(width, x0 + dw + m)
                crop = base[py0:py1, px0:px1].copy()
                d = MODE_DEFAULTS["top"]
                place_pet(crop, pet_rgb, pet_a, cx - px0, cy - py0, d["alpha"], d["color_blend"])
                pv = Image.fromarray((crop * 255).astype(np.uint8))
                pv.thumbnail((500, 500))
                pv.save(review / f"{nick}_c{cid}.jpg", quality=88)

                # map overlay
                color = MAP_COLORS.get(nick, (255, 255, 255))
                mx0, my0 = x0 * map_scale, y0 * map_scale
                mx1, my1 = (x0 + dw) * map_scale, (y0 + dh) * map_scale
                map_draw.rectangle((mx0, my0, mx1, my1), outline=color, width=3)
                map_draw.text((mx0 + 3, my0 + 2), f"{nick[0].upper()}{cid}", fill=color)

            if len(candidates) < args.candidates:
                print(f"  warning: only {len(candidates)} candidates for {nick}")
            manifest["pets"][nick] = candidates

        map_img.save(review / "map.jpg", quality=88)
        (review / "candidates.json").write_text(json.dumps(manifest, indent=1))
        print(f"[roi_{n}] {sum(len(v) for v in manifest['pets'].values())} candidates "
              f"-> {review}")


# ---------------------------------------------------------------- render mode


def _clamp(entry: dict, key: str, default: float) -> float:
    lo, hi = PLAN_LIMITS[key]
    v = float(entry.get(key, default))
    if not lo <= v <= hi:
        print(f"  warning: {entry.get('pet')}: {key}={v} clamped to [{lo}, {hi}]")
    return max(lo, min(hi, v))


def render_plan(
    plan: dict, base: np.ndarray, labels: np.ndarray, tissue: np.ndarray,
    diam: float, out_path: Path, solution_path: Path,
) -> None:
    """Render one placement plan onto `base` (modified in place)."""
    placements: list[tuple[str, int, int, int, int]] = []
    for entry in plan["pets"]:
        photo = photo_for(entry["pet"])
        nick = nickname(photo.stem)
        mode = entry.get("mode", "top")
        if mode not in MODE_DEFAULTS:
            raise SystemExit(f"{nick}: unknown mode {mode!r} (top | behind | inside)")
        defaults = MODE_DEFAULTS[mode]
        alpha = _clamp(entry, "alpha", defaults["alpha"])
        blend = _clamp(entry, "color_blend", defaults["color_blend"])
        size_mult = _clamp(entry, "size_mult", 1.0)
        rotate = _clamp(entry, "rotate_deg", 0.0)
        saturation = _clamp(entry, "saturation", 1.0)
        flip = bool(entry.get("flip", False))
        cx, cy = float(entry["cx"]), float(entry["cy"])

        host_id = 0
        if mode == "inside":
            sh = labels.shape[0] / base.shape[0]
            sw = labels.shape[1] / base.shape[1]
            host_id = int(labels[int(cy * sh), int(cx * sw)])
            if host_id == 0:
                print(f"  warning: {nick}: no cell at ({cx:.0f}, {cy:.0f}), falling back to top")
                mode = "top"

        if mode == "inside":
            # pet sized to nest inside the host cell, not to the global cell scale
            area_full = (labels == host_id).sum() / (sh * sw)
            host_diam = (4 * area_full / np.pi) ** 0.5
            size = round(0.75 * host_diam * size_mult)
        else:
            size = round(diam * size_mult)
        pet_rgb, pet_a = load_pet(get_cutout(photo), size, flip=flip, rotate_deg=rotate)
        dh, dw = pet_a.shape
        face = face_point(photo.stem, dh, dw, flip, rotate)
        if mode == "inside":
            # anchor the FACE on the host-cell centroid so the clip never
            # cuts it: shift the pet center accordingly
            cx = cx + dw / 2 - face[0]
            cy = cy + dh / 2 - face[1]
        y0, x0 = _anchor(base, pet_a, cx, cy)

        alpha_mask = None
        if mode == "behind":
            cover = _clamp(entry, "cover", defaults["cover"])
            crop = _labels_crop(labels, base.shape[:2], y0, x0, dh, dw)
            occ = occlusion_mask(crop, pet_a, cover, face_xy=face)
            alpha_mask = 1.0 - occ
            hidden = (occ * (pet_a > 0.5)).sum() / max(1, (pet_a > 0.5).sum())
            print(f"  {nick}: behind, {hidden:.0%} tucked under cells (face clear)")
        elif mode == "inside":
            crop = _labels_crop(labels, base.shape[:2], y0, x0, dh, dw)
            alpha_mask = ndimage.gaussian_filter(
                (crop == host_id).astype(np.float32), sigma=4
            )
            if alpha_mask[int(face[1]), int(face[0])] < 0.5:
                print(f"  warning: {nick}: face partly outside the host cell")
            print(f"  {nick}: inside cell #{host_id} (~{host_diam:.0f}px, face anchored)")

        y0, x0, dh, dw = place_pet(
            base, pet_rgb, pet_a, cx, cy, alpha, blend, alpha_mask, saturation
        )
        cov = tissue[y0 : y0 + dh, x0 : x0 + dw][pet_a > 0.5].mean()
        if mode != "inside" and cov < 0.85:
            print(f"  warning: {nick} only {cov:.0%} on tissue")
        for name, py, px, ph, pw in placements:
            if not (y0 + dh <= py or py + ph <= y0 or x0 + dw <= px or px + pw <= x0):
                print(f"  warning: {nick} overlaps {name}")
        placements.append((nick, y0, x0, dh, dw))

    out = (base * 255.0).clip(0, 255).astype(np.uint8)
    Image.fromarray(out).save(out_path)
    draw_solution(out, placements, solution_path)


def run_render(args: argparse.Namespace) -> None:
    plan = json.loads(Path(args.plan).read_text())
    n = int(plan["roi"])
    base, diam = load_roi(n, args)
    tissue = tissue_mask(base, diam)
    labels = base_labels(n, base, args.source, diam)
    args.out_dir.mkdir(parents=True, exist_ok=True)
    out_path = args.out_dir / f"wheres_waldog_roi_{n}.png"
    solution_path = args.out_dir / f"wheres_waldog_roi_{n}_solution.png"
    render_plan(plan, base, labels, tissue, diam, out_path, solution_path)
    print(f"[roi_{n}] rendered {len(plan['pets'])} pets from {args.plan} -> {out_path.name}")


# --------------------------------------------------------------- variants mode


def _overlaps(y0: int, x0: int, dh: int, dw: int, placements: list, margin: int) -> bool:
    return not all(
        y0 + dh + margin <= py or py + ph + margin <= y0
        or x0 + dw + margin <= px or px + pw + margin <= x0
        for _, py, px, ph, pw in placements
    )


def _random_plan(
    n: int, rng: random.Random, photos: list[Path], base: np.ndarray,
    diam: float, tissue: np.ndarray, labels: np.ndarray,
    hosts: list[tuple[int, float, float]],
) -> dict:
    """One randomized layout following the curation rules: chicken stays an
    easy 'top' find; the rest get a shuffled mix of top/behind/inside."""
    height, width = base.shape[:2]
    sh = labels.shape[0] / height
    sw = labels.shape[1] / width
    by_nick = {nickname(p.stem): p for p in photos}
    others = [nk for nk in by_nick if nk != "chicken"]
    modes = ["top", "behind", "behind", "inside"]
    rng.shuffle(modes)
    assignment = {"chicken": ("top", True)} | {nk: (m, False) for nk, m in zip(others, modes)}
    # place the constrained modes first: inside (host cells), then behind, then top
    order = sorted(assignment, key=lambda nk: {"inside": 0, "behind": 1, "top": 2}[assignment[nk][0]])

    margin = round(0.5 * diam)
    placements: list[tuple[str, int, int, int, int]] = []
    entries: list[dict] = []
    for nick in order:
        mode, easy = assignment[nick]
        photo = by_nick[nick]
        flip = rng.random() < 0.5
        rotate = round(rng.uniform(-12, 12), 1)
        entry: dict = {"pet": nick, "mode": mode, "flip": flip, "rotate_deg": rotate}
        if easy:
            entry.update(alpha=0.88, color_blend=0.18)
        else:
            lo, hi = PLAN_LIMITS["alpha"]
            entry["alpha"] = round(
                min(hi, max(lo, MODE_DEFAULTS[mode]["alpha"] + rng.uniform(-0.03, 0.03))), 2
            )
            entry["color_blend"] = round(rng.uniform(0.15, 0.20), 2)
            if mode == "inside":
                entry["saturation"] = 1.15
            elif mode == "behind":
                entry["saturation"] = 1.05

        if mode == "inside":
            picked = None
            for host_id, hcy, hcx in rng.sample(hosts, len(hosts)):
                area_full = (labels == host_id).sum() / (sh * sw)
                host_diam = (4 * area_full / np.pi) ** 0.5
                _, pet_a = load_pet(get_cutout(photo), round(0.75 * host_diam), flip, rotate)
                dh, dw = pet_a.shape
                y0, x0 = _anchor(base, pet_a, hcx, hcy)
                if not _overlaps(y0, x0, dh, dw, placements, margin):
                    picked = (hcx, hcy, y0, x0, dh, dw)
                    break
            assert picked is not None, f"no free host cell for {nick}"
            cx, cy, y0, x0, dh, dw = picked
            entry.update(cx=round(cx), cy=round(cy))
        else:
            entry["size_mult"] = round(rng.uniform(0.95, 1.15), 2)
            if mode == "behind":
                entry["cover"] = round(rng.uniform(0.35, 0.55), 2)
            _, pet_a = load_pet(
                get_cutout(photo), round(diam * entry["size_mult"]), flip, rotate
            )
            dh, dw = pet_a.shape
            opaque = pet_a > 0.5
            spot = None
            for _ in range(MAX_PLACEMENT_TRIES):
                y0 = rng.randint(0, height - dh)
                x0 = rng.randint(0, width - dw)
                if _overlaps(y0, x0, dh, dw, placements, margin):
                    continue
                if tissue[y0 : y0 + dh, x0 : x0 + dw][opaque].mean() < TISSUE_COVERAGE:
                    continue
                if mode == "behind":
                    # the occlusion target must be reachable: enough segmented
                    # cell area under the pet bbox (checked in label space)
                    lc = labels[int(y0 * sh) : int((y0 + dh) * sh), int(x0 * sw) : int((x0 + dw) * sw)]
                    if (lc > 0).mean() < entry["cover"]:
                        continue
                spot = (y0, x0)
                break
            assert spot is not None, f"no free spot for {nick} ({mode})"
            y0, x0 = spot
            entry.update(cx=round(x0 + dw / 2), cy=round(y0 + dh / 2))
        placements.append((nick, y0, x0, dh, dw))
        entries.append(entry)

    # keep the plan file in the familiar pet order
    order_index = {nk: i for i, nk in enumerate(by_nick)}
    entries.sort(key=lambda e: order_index[e["pet"]])
    return {"roi": n, "pets": entries}


def run_variants(args: argparse.Namespace) -> None:
    photos = pet_photos()
    plans_dir = PLANS_DIR / "variants"
    plans_dir.mkdir(parents=True, exist_ok=True)
    out_dir = args.out_dir / "variants"
    out_dir.mkdir(parents=True, exist_ok=True)
    seed = args.seed if args.seed is not None else 0

    for n in parse_rois(args.rois):
        base, diam = load_roi(n, args)
        tissue = tissue_mask(base, diam)
        labels = base_labels(n, base, args.source, diam)
        ids, counts = np.unique(labels[labels > 0], return_counts=True)
        big = ids[np.argsort(counts)[::-1][:40]]
        coms = ndimage.center_of_mass(labels > 0, labels, big)
        sh = labels.shape[0] / base.shape[0]
        sw = labels.shape[1] / base.shape[1]
        hosts = [(int(i), cy / sh, cx / sw) for i, (cy, cx) in zip(big, coms)]

        sheets = []
        for v in range(1, args.count + 1):
            rng = random.Random(seed + 100 * n + v)
            plan = _random_plan(n, rng, photos, base, diam, tissue, labels, hosts)
            plan_path = plans_dir / f"roi_{n}_v{v}.json"
            plan_path.write_text(json.dumps(plan, indent=1))
            out_path = out_dir / f"wheres_waldog_roi_{n}_v{v}.png"
            solution_path = out_dir / f"wheres_waldog_roi_{n}_v{v}_solution.png"
            modes = {e["pet"]: e["mode"] for e in plan["pets"]}
            print(f"[roi_{n}] v{v}: {modes}")
            render_plan(plan, base.copy(), labels, tissue, diam, out_path, solution_path)
            sheets.append((f"v{v}", solution_path))

        # side-by-side overview of the 5 solutions for manual selection
        thumbs = []
        for label, path in sheets:
            im = Image.open(path)
            im.thumbnail((900, 900))
            thumbs.append((label, im))
        tw = max(im.width for _, im in thumbs)
        th = max(im.height for _, im in thumbs)
        cols = 2
        rows = (len(thumbs) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * (tw + 10), rows * (th + 26)), (18, 18, 18))
        drawer = ImageDraw.Draw(sheet)
        for k, (label, im) in enumerate(thumbs):
            x = (k % cols) * (tw + 10)
            y = (k // cols) * (th + 26)
            sheet.paste(im, (x, y + 22))
            drawer.text((x + 4, y + 4), f"{label}  (plans/variants/roi_{n}_{label}.json)",
                        fill=(255, 220, 80))
        overview = out_dir / f"roi_{n}_overview.jpg"
        sheet.save(overview, quality=85)
        print(f"[roi_{n}] {args.count} variants -> {overview}")


# ----------------------------------------------------------------------- CLI


def parse_rois(rois: str) -> list[int]:
    return [int(x) for x in rois.split(",")]


def load_roi(n: int, args: argparse.Namespace) -> tuple[np.ndarray, float]:
    png = args.source / f"roi_{n:02d}.png"
    assert png.exists(), f"{png} not found (run scientifica-ingest first)"
    print(f"[roi_{n}] loading {png.name}...")
    base = load_base(png)
    diam = args.cell_size or cell_diameter(n, base, args.source)
    print(f"[roi_{n}] pets sized to ~{diam:.0f}px (local cell diameter)")
    return base, diam


def _common_args(p: argparse.ArgumentParser) -> None:
    p.add_argument("--source", type=Path, default=DEFAULT_SOURCE_DIR,
                   help="Directory with the 3-color ROI pngs (default: data/source/waldog)")
    p.add_argument("--rois", default=DEFAULT_ROIS,
                   help=f"Comma-separated ROI numbers (default: {DEFAULT_ROIS})")
    p.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR,
                   help="Directory for the puzzle and solution PNGs (default: waldog/output)")
    p.add_argument("--seed", type=int, default=None,
                   help="Random seed for reproducible placement")
    p.add_argument("--cell-size", type=float, default=None,
                   help="Override the cell diameter (px in print space) instead of measuring it")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    _common_args(parser)
    sub = parser.add_subparsers(dest="cmd")

    p_propose = sub.add_parser("propose", help="render candidate spots per pet for review")
    _common_args(p_propose)
    p_propose.add_argument("--candidates", type=int, default=6,
                           help="candidate spots per pet (default: 6)")

    p_render = sub.add_parser("render", help="render a print from a placement plan")
    _common_args(p_render)
    p_render.add_argument("--plan", required=True, help="path to a plan JSON (see waldog/plans/)")

    p_var = sub.add_parser(
        "variants",
        help="render N randomized layouts per ROI for manual selection "
             "(promote one with: waldog render --plan waldog/plans/variants/roi_<n>_v<k>.json)",
    )
    _common_args(p_var)
    p_var.add_argument("--count", type=int, default=5, help="variants per ROI (default: 5)")

    args = parser.parse_args()
    if args.cmd == "propose":
        run_propose(args)
    elif args.cmd == "render":
        run_render(args)
    elif args.cmd == "variants":
        run_variants(args)
    else:
        run_random(args)


if __name__ == "__main__":
    main()
