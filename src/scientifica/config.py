"""Central paths and defaults shared by the pipeline and the server."""

from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = PROJECT_ROOT / "data" / "source"
NAPARI_DIR = SOURCE_DIR / "napari"  # 2-color display pngs (dashboard/game)
WALDOG_DIR = SOURCE_DIR / "waldog"  # 3-color pngs (waldog prints)
RAW_TIFF_DIR = SOURCE_DIR / "raw"  # per-roi channel + nuclei-label tiffs
DERIVED_DIR = PROJECT_ROOT / "data" / "derived"
DB_PATH = PROJECT_ROOT / "data" / "game.db"
MANIFEST_PATH = DERIVED_DIR / "manifest.json"

# Working resolution: long side of every derived image. All downstream
# coordinates (features, polygons, clicks, live-compute regions) live in this space.
WORKING_LONG_SIDE = 2048
HERO_LONG_SIDE = 4096
HERO_IDS = {"roi_12"}

# Long side of display.jpg (napari render shown full-bleed on the TV)
DISPLAY_LONG_SIDE = 2560

# Official ROI names from ROI_naming.xlsx (data/ is gitignored, so the mapping
# lives in code). roi_13 exists only as a waldog print, not in the manifest.
ROI_NAMES = {
    "roi_00": "Field 1",
    "roi_01": "Field 7",
    "roi_02": "Field 2",
    "roi_03": "Field 3",
    "roi_04": "Field 4",
    "roi_05": "Field 5",
    "roi_06": "Field 6",
    "roi_07": "Field 8",
    "roi_08": "Field 9",
    "roi_09": "Field 10",
    "roi_10": "Field 11",
    "roi_11": "Field 12",
    "roi_12": "Field 14",
    "roi_13": "Field 13",
}

# Raw tiff channels: key -> (display label, default blend color)
CHANNEL_DEFS = {
    "dapi": ("DAPI", "#00AAFF"),
    "lamin_b1": ("Lamin B1", "#FF00FF"),
    "nanog": ("nanog", "#FFE94F"),
}
# Percentile window baked into the 8-bit channel PNGs
CHANNEL_STRETCH = (0.1, 99.8)

# Black-border autocrop
CROP_THRESHOLD = 15  # rgb.sum(-1) above this counts as content
CROP_MARGIN = 16

# Default analysis parameters (also exposed to the frontend via the manifest)
DEFAULTS = {
    "denoise": {"method": "gaussian", "strength": 1.5},
    "stretch": [1.0, 99.5],
    "diameter_px": None,  # filled in by the pipeline (median cell diameter)
    "sensitivity": 50,  # 0-100 UI knob -> cellprob_threshold +3..-3
}

# Live compute caps
LIVE_REGION_MAX = 1024  # px, longest side of a live-compute region
