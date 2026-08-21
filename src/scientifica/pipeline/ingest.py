"""One-time normalizer: copy the "Game Images" delivery into data/source/.

Usage: uv run scientifica-ingest ["~/Downloads/Game Images"] [--force]

Source layout it understands:
  napari/scientifica_roi_<n>.png            -> data/source/napari/roi_NN.png
  napari/Scientifica_*_ROI<n>_3colors.png   -> data/source/waldog/roi_NN.png
                                               (only the waldog ROIs 1, 7, 13)
  data/(B03_)?roi_<n>_<channel>.tiff        -> data/source/raw/roi_NN/<key>.tiff
"""

import argparse
import re
import shutil
from pathlib import Path

from scientifica import config

WALDOG_ROIS = {1, 7, 13}

TIFF_KEYS = {
    "DAPI": "dapi",
    "Lamin B1": "lamin_b1",
    "nanog": "nanog",
    "nuclei": "nuclei",
}


def _plan(source: Path) -> list[tuple[Path, Path]]:
    """(src, dst) pairs for every recognized file; raises on surprises."""
    pairs: list[tuple[Path, Path]] = []
    skipped: list[str] = []

    napari = source / "napari"
    for path in sorted(napari.iterdir()):
        if path.name.startswith(("~$", ".")) or path.suffix.lower() != ".png":
            continue
        m = re.fullmatch(r"scientifica_roi_(\d+)\.png", path.name)
        if m:
            pairs.append((path, config.NAPARI_DIR / f"roi_{int(m.group(1)):02d}.png"))
            continue
        m = re.fullmatch(r"Scientifica_\w+_ROI(\d+)_3colors\.png", path.name)
        if m:
            n = int(m.group(1))
            if n in WALDOG_ROIS:
                pairs.append((path, config.WALDOG_DIR / f"roi_{n:02d}.png"))
            else:
                skipped.append(path.name)
            continue
        raise SystemExit(f"unrecognized napari file: {path.name}")

    tiffs = source / "data"
    for path in sorted(tiffs.iterdir()):
        if path.name.startswith(("~$", ".")) or path.suffix.lower() not in (".tif", ".tiff"):
            continue
        m = re.fullmatch(r"(?:B03_)?roi_(\d+)_(.+)\.tiff?", path.name)
        if not m or m.group(2) not in TIFF_KEYS:
            raise SystemExit(f"unrecognized tiff: {path.name}")
        image_id = f"roi_{int(m.group(1)):02d}"
        pairs.append((path, config.RAW_TIFF_DIR / image_id / f"{TIFF_KEYS[m.group(2)]}.tiff"))

    for name in skipped:
        print(f"skipping (not a waldog ROI): {name}")
    return pairs


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "source",
        nargs="?",
        default=str(Path.home() / "Downloads" / "Game Images"),
        help='delivery folder (default: "~/Downloads/Game Images")',
    )
    parser.add_argument("--force", action="store_true", help="overwrite existing files")
    args = parser.parse_args()

    source = Path(args.source).expanduser()
    if not (source / "napari").is_dir() or not (source / "data").is_dir():
        raise SystemExit(f"{source} does not look like a Game Images delivery (napari/ + data/)")

    copied = existing = 0
    for src, dst in _plan(source):
        if dst.exists() and not args.force:
            existing += 1
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        rel = dst.relative_to(config.SOURCE_DIR)
        print(f"{src.name:48s} -> {rel}")
        copied += 1

    print(f"done: {copied} copied, {existing} already present (use --force to overwrite)")


if __name__ == "__main__":
    main()
