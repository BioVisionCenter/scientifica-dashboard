"""Per-cell measurements: regionprops features + simplified outline polygons."""

import numpy as np
from skimage.measure import approximate_polygon, find_contours, regionprops

FEATURE_KEYS = [
    {"key": "area", "label": "Area (px²)"},
    {"key": "equivalent_diameter", "label": "Diameter (px)"},
    {"key": "perimeter", "label": "Perimeter (px)"},
    {"key": "eccentricity", "label": "Eccentricity"},
    {"key": "solidity", "label": "Solidity"},
    {"key": "mean_nuclei", "label": "DAPI intensity"},
    {"key": "mean_membrane", "label": "Lamin B1 intensity"},
]


def _outline_polygon(region, tolerance: float = 1.5) -> list[list[float]]:
    """Simplified outline polygon of one region, in image coords [[x, y], ...]."""
    padded = np.pad(region.image, 1)
    contours = find_contours(padded.astype(np.float32), 0.5)
    if not contours:
        return []
    contour = max(contours, key=len)
    simplified = approximate_polygon(contour, tolerance=tolerance)
    y0, x0 = region.bbox[0], region.bbox[1]
    # contour coords are (row, col) in the padded crop; -1 removes the pad
    return [
        [round(float(c - 1 + x0), 1), round(float(r - 1 + y0), 1)]
        for r, c in simplified
    ]


def measure_cells(
    labels: np.ndarray, nuclei: np.ndarray, membrane: np.ndarray
) -> list[dict]:
    """Feature records for every cell, polygons included."""
    nuc = nuclei.astype(np.float32)
    mem = membrane.astype(np.float32)
    cells = []
    for region in regionprops(labels, intensity_image=nuc):
        cy, cx = region.centroid
        sl = region.slice
        mask = region.image
        cells.append(
            {
                "label": int(region.label),
                "centroid": [round(float(cx), 1), round(float(cy), 1)],
                "bbox": [int(region.bbox[1]), int(region.bbox[0]), int(region.bbox[3]), int(region.bbox[2])],
                "polygon": _outline_polygon(region),
                "area": float(region.area),
                "equivalent_diameter": round(float(region.equivalent_diameter_area), 2),
                "perimeter": round(float(region.perimeter), 2),
                "eccentricity": round(float(region.eccentricity), 4),
                "solidity": round(float(region.solidity), 4),
                "mean_nuclei": round(float(region.image_intensity[mask].mean()), 2),
                "mean_membrane": round(float(mem[sl][mask].mean()), 2),
            }
        )
    return cells
