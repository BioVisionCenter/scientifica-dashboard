"""Central paths and defaults shared by the pipeline and the server."""

from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = PROJECT_ROOT / "scietifica_data"
DERIVED_DIR = PROJECT_ROOT / "data" / "derived"
DB_PATH = PROJECT_ROOT / "data" / "game.db"
MANIFEST_PATH = DERIVED_DIR / "manifest.json"

# Working resolution: long side of every derived image. All downstream
# coordinates (features, polygons, clicks, live-compute regions) live in this space.
WORKING_LONG_SIDE = 2048
HERO_LONG_SIDE = 4096
HERO_IDS = {"roi_12"}

# Black-border autocrop
CROP_THRESHOLD = 15  # rgb.sum(-1) above this counts as content
CROP_MARGIN = 16

# Default analysis parameters (also exposed to the frontend via the manifest)
DEFAULTS = {
    "denoise": {"method": "gaussian", "strength": 1.5},
    "stretch": [1.0, 99.5],
    "diameter_px": None,  # filled in by the pipeline after auto-estimation
    "sensitivity": 50,  # 0-100 UI knob -> cellprob_threshold +3..-3
}

# Live compute caps
LIVE_REGION_MAX = 1024  # px, longest side of a live-compute region

# Channel colors used to recomposite grayscale channels into the display look
NUCLEI_HEX = "#00FFFF"  # cyan
MEMBRANE_HEX = "#FF00FF"  # magenta
