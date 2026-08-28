# Where's Waldog

Hides background-removed pet photos in the 3-color Scientifica ROI renders so
visitors can hunt for them on printed posters. Produces a puzzle and an answer
key (red circles) per ROI in `output/`.

## Run

From the repo root (this is a uv workspace member):

```bash
uv sync --all-packages                                   # once
uv run --package waldog waldog [--rois 1,7,13] [--seed N] [--out-dir DIR] [--cell-size PX]
```

Modes:

| command | what it does |
|---|---|
| `waldog` | random placement — one `wheres_waldog_roi_<n>.png` + `_solution.png` per ROI, pets only on tissue |
| `waldog variants --seed 42 [--count 5]` | N randomized full layouts per ROI → `plans/variants/roi_<n>_v<k>.json` + renders + a side-by-side `output/variants/roi_<n>_overview.jpg` to pick from |
| `waldog propose [--candidates 6]` | renders candidate spots per pet (+ `map.jpg`, `candidates.json`) into `review/roi_<n>/` for visual curation |
| `waldog render --plan plans/roi_<n>.json` | renders from a curated plan — **this is how the booth prints are made** |

Inputs are the 3-color renders `data/source/waldog/roi_NN.png` (ROIs 1, 7 and
13; not in git). The committed plans in `plans/` are the source of truth for
the prints (difficulty ramp: chicken easy → cockatiel → spaniel / black dog →
cat); re-render them, don't regenerate randomly.

## Plans

A plan lists, per pet: `cx`, `cy`, `mode`, `alpha`, `color_blend`, `flip`,
`rotate_deg`, `size_mult`, `cover`, `saturation`, clamped by `PLAN_LIMITS` in
`src/waldog/main.py`. Depth modes: `top` (default), `behind` (cells occlude the
pet, ≤60 % hidden via `cover`), `inside` (pet clipped into the cell at
`cx, cy`). Pets never go fully solid (alpha ceiling 0.9) and their faces are
protected (`FACE_ANCHORS`).

## Cell size and segmentation

Pets are scaled to the local nucleus size. The size comes from the dashboard
manifest (`data/derived/manifest.json`, `diameter_px` rescaled to the print)
or `--cell-size`; `behind`/`inside` need a segmentation of the print, computed
once with cellpose-SAM (cellpose 4) and cached as
`data/source/waldog/labels_roi_<n>.npy` (delete to recompute). Sizes are cached
in `data/source/waldog/cell_sizes.json`.

## Pet photos

Photos live in `waldog-pets/` (committed, EXIF stripped). Cutouts are cached in
`waldog-pets/cutouts/` (gitignored); a new photo is cut out on first use with
`uv tool run --from "rembg[cpu,cli]" rembg` (the cat and the black dog use the
`birefnet-general` model — see `REMBG_MODELS`), which downloads the model into
the user-level rembg cache.
