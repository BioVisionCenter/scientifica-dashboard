"""Central paths and defaults shared by the pipeline and the server."""

import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = PROJECT_ROOT / "data" / "source"
WALDOG_DIR = SOURCE_DIR / "waldog"  # 3-color pngs (waldog prints)
DERIVED_DIR = PROJECT_ROOT / "data" / "derived"
DB_PATH = PROJECT_ROOT / "data" / "game.db"
MANIFEST_PATH = DERIVED_DIR / "manifest.json"

# The single source of truth: the whole-well OME-Zarr (NGFF 0.4, axes c,z,y,x).
# It is served as-is under /assets/source; every dashboard ROI is a bbox from
# ROI_TABLE in level-0 pixels of this image, and the segmentation label lives
# inside it as labels/nuclei.
SOURCE_ZARR_NAME = "Cardiomyocyte_mip_scientifica_2026.zarr"
SOURCE_ZARR_PATH = SOURCE_DIR / SOURCE_ZARR_NAME
SOURCE_ZARR_URL = f"/assets/source/{SOURCE_ZARR_NAME}"
ROI_TABLE = "scientifica_ROI_table_v3"
KEEP_TABLES = {ROI_TABLE}  # `clean` deletes every other table
CURATED_LABEL = "nuclei"  # the whole-well segmentation label
LABEL_CHUNKS = (512, 512)  # (y, x) chunks of labels derived from the image
LIVE_LABEL_PREFIX = "live_"
LIVE_KEEP = 3  # live labels (+ tables + cells json) kept per ROI

# Long side of the per-ROI posters (TV idle show, game)
DISPLAY_LONG_SIDE = 2560


def zarr_path() -> Path:
    return SOURCE_ZARR_PATH


def zarr_url() -> str:
    return SOURCE_ZARR_URL


def roi_dir(image_id: str) -> Path:
    return DERIVED_DIR / image_id


# Official display names from ROI_naming.xlsx, keyed by the ROI table's
# FieldIndex (data/ is gitignored, so the mapping lives in code). NOTE: the
# index is not the field number — roi_1 is "Field 7".
ROI_NAMES = {
    "roi_0": "Field 1",
    "roi_1": "Field 7",
    "roi_2": "Field 2",
    "roi_3": "Field 3",
    "roi_4": "Field 4",
    "roi_5": "Field 5",
    "roi_6": "Field 6",
    "roi_7": "Field 8",
    "roi_8": "Field 9",
    "roi_9": "Field 10",
    "roi_10": "Field 11",
    "roi_11": "Field 12",
    "roi_12": "Field 14",
    "roi_13": "Field 13",
}
HERO_IDS = {"roi_12"}

# Channel key -> omero label in the store (colours/windows come from the store)
CHANNEL_DEFS = {
    "dapi": "DAPI",
    "nanog": "nanog",
    "lamin_b1": "Lamin B1",
}
NUCLEI_CHANNEL = "dapi"
MEMBRANE_CHANNEL = "lamin_b1"

# Default analysis parameters (also exposed to the frontend via the manifest)
DEFAULTS = {
    "denoise": {"method": "gaussian", "strength": 1.5},
    "stretch": [1.0, 99.5],
    "diameter_px": None,  # filled in by the pipeline (median cell diameter)
    "sensitivity": 50,  # 0-100 UI knob -> cellprob_threshold +3..-3
}

# cellpose-SAM (cellpose 4)
CPSAM_MODEL = os.environ.get("SCIENTIFICA_CPSAM_MODEL", "cpsam_v2")
CPSAM_BF16 = os.environ.get("SCIENTIFICA_CPSAM_BF16", "1") == "1"

# Offline whole-well segmentation (native level 0, nuclei ~75 px)
SEG_TILE = 1024
SEG_DIAMETER_PX = 75.0
SEG_NITER = 500
SEG_FLOW_THRESHOLD = 0.4
SEG_CELLPROB = 0.0

# Live compute (tiled through ngio iterators, region = ROI bbox ∩ drawn rect)
LIVE_TILE = 1024  # segmentation grid tile, level-0 px
LIVE_MAX_PIXELS = {"cellpose": 60_000_000, "otsu": 300_000_000}
FEATURE_TILE = 2048  # feature-extraction grid tile
CELLPOSE_WORKERS = 1  # one shared torch model
OTSU_WORKERS = 4
FEATURE_WORKERS = 4
