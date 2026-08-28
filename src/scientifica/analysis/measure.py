"""Per-cell measurements through ngio's FeatureExtractorIterator.

`measure_patch` runs on one (haloed) tile and returns regionprops rows in
level-0 pixel coordinates; `InteriorJoin` reconciles the duplicate rows a
border object gets from every tile that sees it.
"""

from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from ngio import FeatureExtractorIterator, OmeZarrContainer, Roi
from ngio.iterators import MapperProtocol
from ngio.tables import FeatureTable
from skimage.measure import regionprops

from scientifica import config

FEATURE_KEYS = [
    {"key": "area", "label": "Area (px²)"},
    {"key": "equivalent_diameter", "label": "Diameter (px)"},
    {"key": "perimeter", "label": "Perimeter (px)"},
    {"key": "eccentricity", "label": "Eccentricity"},
    {"key": "solidity", "label": "Solidity"},
    {"key": "mean_nuclei", "label": "DAPI intensity"},
    {"key": "mean_membrane", "label": "Lamin B1 intensity"},
]
SCALAR_COLUMNS = [f["key"] for f in FEATURE_KEYS]


@dataclass
class PatchMeasurer:
    """`(image, label, roi) -> DataFrame` for FeatureExtractorIterator.measure.

    image: (c, y, x) raw uint16 (channel indices resolved by omero label);
    label: (y, x) uint32; roi: the (halo-grown) region the patches cover.
    `bounds` = (x0, y0, x1, y1) of the measured area in level-0 px: an object
    touching a tile edge that is not a bounds edge is (possibly) cut.
    """

    bounds: tuple[int, int, int, int]
    pixel_size: object  # ngio PixelSize
    nuc_idx: int = 0
    mem_idx: int = 0

    def __call__(self, image: np.ndarray, label: np.ndarray, roi: Roi) -> pd.DataFrame:
        p = roi.to_pixel(self.pixel_size)
        x0 = int(round(p["x"].start))
        y0 = int(round(p["y"].start))
        # ngio hands the label back in the image's axes order (singleton axes)
        label = np.asarray(label).reshape(label.shape[-2:])
        image = np.asarray(image).reshape(-1, *image.shape[-2:])
        ph, pw = label.shape
        bx0, by0, bx1, by1 = self.bounds
        nuc = image[self.nuc_idx].astype(np.float32)
        mem = image[self.mem_idx].astype(np.float32)
        rows = []
        for r in regionprops(label.astype(np.int64), intensity_image=nuc):
            cy, cx = r.centroid
            rby0, rbx0, rby1, rbx1 = r.bbox
            mask = r.image
            complete = not (
                (rby0 == 0 and y0 > by0)
                or (rbx0 == 0 and x0 > bx0)
                or (rby1 == ph and y0 + ph < by1)
                or (rbx1 == pw and x0 + pw < bx1)
            )
            rows.append(
                {
                    "label": int(r.label),
                    "cx": round(float(cx + x0), 1),
                    "cy": round(float(cy + y0), 1),
                    "x0": int(rbx0 + x0),
                    "y0": int(rby0 + y0),
                    "x1": int(rbx1 + x0),
                    "y1": int(rby1 + y0),
                    "area": float(r.area),
                    "equivalent_diameter": round(float(r.equivalent_diameter_area), 2),
                    "perimeter": round(float(r.perimeter), 2),
                    "eccentricity": round(float(r.eccentricity), 4),
                    "solidity": round(float(r.solidity), 4),
                    "mean_nuclei": round(float(r.image_intensity[mask].mean()), 2),
                    "mean_membrane": round(float(mem[r.slice][mask].mean()), 2),
                    "complete": bool(complete),
                }
            )
        if not rows:
            return pd.DataFrame()
        return pd.DataFrame(rows)


@dataclass
class InteriorJoin:
    """Keep one row per label: a complete measurement wins, else the largest fragment."""

    reference_label: str
    cells_frame: pd.DataFrame | None = field(default=None, init=False)

    def __call__(self, results: list[pd.DataFrame]) -> FeatureTable:
        frames = [f for f in results if len(f)]
        if not frames:
            df = pd.DataFrame({"label": pd.Series([], dtype="int64")})
        else:
            df = pd.concat(frames, ignore_index=True)
            df = df.sort_values(["label", "complete", "area"], ascending=[True, False, False])
            df = df.drop_duplicates("label", keep="first")
            df = df.drop(columns=["roi_index", "roi_name", "complete"], errors="ignore")
            df = df.sort_values("label").reset_index(drop=True)
        self.cells_frame = df
        scalar = df[["label", *[c for c in SCALAR_COLUMNS if c in df.columns]]].set_index("label")
        return FeatureTable(table_data=scalar, reference_label=self.reference_label)


def cells_from_frame(df: pd.DataFrame) -> list[dict]:
    """Viewer records: label, centroid, bbox + scalar features (level-0 px)."""
    if df is None or not len(df):
        return []
    cells = []
    for row in df.itertuples(index=False):
        rec = {
            "label": int(row.label),
            "centroid": [float(row.cx), float(row.cy)],
            "bbox": [int(row.x0), int(row.y0), int(row.x1), int(row.y1)],
        }
        for key in SCALAR_COLUMNS:
            rec[key] = float(getattr(row, key))
        cells.append(rec)
    return cells


def measure_label(
    ome: OmeZarrContainer,
    label_name: str,
    region: Roi | None,
    diameter_px: float,
    bounds: tuple[int, int, int, int] | None = None,
    mapper: MapperProtocol | None = None,
) -> tuple[FeatureTable, list[dict]]:
    """Measure every object of `label_name` (inside `region` if given).

    `bounds` (x0, y0, x1, y1) is the area whose edges count as real borders
    for the completeness test — the region's box for a live run, the whole
    image otherwise.
    """
    from scientifica.analysis import store

    image = ome.get_image()
    label = ome.get_label(label_name)
    h, w = int(image.shape[-2]), int(image.shape[-1])
    if bounds is None:
        bounds = store.roi_pixel_box(region, ome) if region is not None else (0, 0, w, h)
    it = FeatureExtractorIterator(image, label, axes_order=["c", "y", "x"])
    if region is not None:
        it = it.product([region])
    halo = int(max(32, 3 * diameter_px))
    join = InteriorJoin(reference_label=label_name)
    it = (
        it.by_grid(size_x=config.FEATURE_TILE, size_y=config.FEATURE_TILE, tail="balance")
        .with_halo(x=halo, y=halo)
        .with_join(join)
    )
    measurer = PatchMeasurer(
        bounds,
        image.pixel_size,
        nuc_idx=store.channel_index(ome, config.NUCLEI_CHANNEL),
        mem_idx=store.channel_index(ome, config.MEMBRANE_CHANNEL),
    )
    table = it.measure(measurer, mapper=mapper)
    return table, cells_from_frame(join.cells_frame)


def split_cells_by_roi(cells: list[dict], boxes: dict) -> dict[str, list[dict]]:
    """Cells whose centroid lies inside each ROI bbox (a cell may hit several)."""
    out: dict[str, list[dict]] = {rid: [] for rid in boxes}
    for c in cells:
        cx, cy = c["centroid"]
        for rid, box in boxes.items():
            if box.contains(cx, cy):
                out[rid].append(c)
    return out
