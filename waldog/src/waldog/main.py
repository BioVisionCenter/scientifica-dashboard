"""Where's Waldog: hide pet cutouts in a rendered OME-Zarr microscopy image."""

import argparse
import random
import subprocess
from pathlib import Path

import numpy as np
import PIL.Image as Image
import PIL.ImageDraw as ImageDraw
from scipy import ndimage

from ngio import open_ome_zarr_container

DEFAULT_ZARR_PATH = "/Users/locerr/Projects/OMEZarr/ngio/data/20200812-CardiomyocyteDifferentiation14-Cycle1-small-mip.zarr/B/03/0"

PROJECT_DIR = Path(__file__).resolve().parents[2]
PETS_DIR = PROJECT_DIR / "waldog-pets"
CUTOUT_DIR = PETS_DIR / "cutouts"
DEFAULT_OUT_DIR = PROJECT_DIR / "output"

# --- Difficulty knobs (defaults = Medium) ---
PET_SIZE_RANGE = (90, 130)  # scaled pet size (sqrt of area), per pet; smaller = harder
PET_ALPHA = 0.90  # overall opacity of the pets; lower = harder
COLOR_BLEND = 0.2  # 0..1 how much to pull pet colors toward local background
MAX_PLACEMENT_TRIES = 500  # attempts to find a non-overlapping spot per pet


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
    subprocess.run(
        # onnxruntime has no free-threaded wheels yet, so pin a regular Python.
        ["uv", "tool", "run", "--python", "3.12", "--from", "rembg[cpu,cli]",
         "rembg", "i", str(src), str(dst)],
        check=True,
    )
    return dst


def load_pet(cutout: Path, size_px: int) -> tuple[np.ndarray, np.ndarray]:
    """Load an RGBA cutout, crop it to its subject and scale it so its area
    is roughly size_px**2 (fair footprint for squat and tall pets alike)."""
    pet = Image.open(cutout).convert("RGBA")

    # Segmentation sometimes keeps disconnected background chunks (e.g. a
    # piece of pillow); keep only the largest connected blob of the mask.
    arr = np.array(pet)
    labels, n = ndimage.label(arr[..., 3] > 25)
    if n > 1:
        sizes = ndimage.sum_labels(np.ones_like(labels), labels, range(1, n + 1))
        arr[..., 3] *= labels == (np.argmax(sizes) + 1)
        pet = Image.fromarray(arr)

    bbox = pet.getchannel("A").getbbox()
    assert bbox is not None, f"Cutout {cutout.name} is fully transparent"
    pet = pet.crop(bbox)
    scale = size_px / (pet.width * pet.height) ** 0.5
    pet = pet.resize(
        (max(round(pet.width * scale), 1), max(round(pet.height * scale), 1)),
        Image.LANCZOS,
    )
    arr = np.array(pet, dtype=np.float32) / 255.0
    return arr[..., :3], arr[..., 3]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--zarr-path",
        default=DEFAULT_ZARR_PATH,
        help="Path to an OME-Zarr image with channel metadata (default: sample data in a local ngio checkout)",
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
    args = parser.parse_args()

    out_dir: Path = args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "wheres_waldog.png"
    solution_path = out_dir / "wheres_waldog_solution.png"

    ome_zarr = open_ome_zarr_container(args.zarr_path)
    image = ome_zarr.get_image()

    channel_meta = ome_zarr.meta.channels_meta
    assert channel_meta is not None, "Channel metadata is missing"
    for i, channel in enumerate(channel_meta.channels):
        print(f"i: {i}, label: {channel.label}, color: {channel.channel_visualisation.color}, range: {channel.channel_visualisation.end - channel.channel_visualisation.start}")

    # --- 1. Render the multi-channel microscopy image into an RGB picture ---
    # Drop the singleton Z axis -> (C, Y, X).
    data = np.squeeze(image.get_as_numpy(), axis=1)
    height, width = data.shape[1:]

    rgb = np.zeros((height, width, 3), dtype=np.float32)
    for i, channel in enumerate(channel_meta.channels):
        vis = channel.channel_visualisation
        lo, hi = float(vis.start), float(vis.end)
        norm = np.clip((data[i].astype(np.float32) - lo) / max(hi - lo, 1e-6), 0.0, 1.0)
        rgb += norm[..., None] * hex_to_rgb(vis.color)

    base = np.clip(rgb, 0.0, 1.0)

    # --- 2. Prepare the pets: background removed, smaller and camouflaged ---
    CUTOUT_DIR.mkdir(exist_ok=True)
    pet_photos = sorted(
        p for p in PETS_DIR.iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png"}
    )
    assert pet_photos, f"No pet images found in {PETS_DIR}"

    random.seed(args.seed)

    # --- 3. Hide each pet at a random spot that fits and does not overlap ---
    placements: list[tuple[str, int, int, int, int]] = []
    for photo in pet_photos:
        pet_rgb, pet_a = load_pet(get_cutout(photo), random.randint(*PET_SIZE_RANGE))
        dh, dw = pet_a.shape

        spot = None
        for _ in range(MAX_PLACEMENT_TRIES):
            y0 = random.randint(0, height - dh)
            x0 = random.randint(0, width - dw)
            margin = 10
            if all(
                y0 + dh + margin <= py or py + ph + margin <= y0
                or x0 + dw + margin <= px or px + pw + margin <= x0
                for _, py, px, ph, pw in placements
            ):
                spot = (y0, x0)
                break
        assert spot is not None, f"Could not find a free spot for {photo.stem}"
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

    # --- 4. Solution image: same picture with a circle around each hidden pet ---
    solution = Image.fromarray(out)
    draw = ImageDraw.Draw(solution)
    for name, y0, x0, dh, dw in placements:
        cy, cx = y0 + dh / 2, x0 + dw / 2
        radius = max(dh, dw) * 0.9
        draw.ellipse(
            (cx - radius, cy - radius, cx + radius, cy + radius),
            outline=(255, 0, 0),
            width=max(round(radius / 25), 3),
        )
        print(f"Hid {name} at (y={y0}, x={x0})")
    solution.save(solution_path)

    print(f"Find all {len(placements)} pets in {out_path}!")
    print(f"Answer key written to {solution_path}.")


if __name__ == "__main__":
    main()
