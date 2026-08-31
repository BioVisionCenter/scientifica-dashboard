# Scientifica bioimage dashboard

Event dashboard for the bioimage-analysis booth at Scientifica 2026: an 
interactive analysis showcase and a cell-counting game, shown fullscreen on a 
TV and driven from a laptop on the same network. The admin picks a round image, 
the TV shows it with a stopwatch, and the app records attempts, scores them, 
and animates the leaderboard.

## Install

### 1. Get the data

Everything is driven by one whole-well OME-Zarr:

> 📦 **Download `Cardiomyocyte_mip_scientifica_2026.zarr.zip` (zip, ~1.4 GB):** https://zenodo.org/records/22201727

Unzip it so that it sits at `data/source/Cardiomyocyte_mip_scientifica_2026.zarr`
(`data/source/` is not in git). The package is already fully processed:

- the 3-channel image pyramid (DAPI, nanog, Lamin B1; 20480 × 19440 px at
  0.1625 µm/px, 5 levels, rechunked to 512² for the viewer)
- `tables/scientifica_ROI_table_v3` — the 14 fields shown in the dashboard
- `labels/nuclei` + `tables/nuclei_features` — the cellpose-SAM segmentation of
  the whole well (40 667 nuclei)

The small derived files are committed (`data/derived/manifest.json`,
`game.json`, `benchmarks.json` and the per-ROI posters), so no pipeline run is
needed to start.

The Zenodo repository also contains print-ready high-resolution PDFs for all 
fields that a are used in the game. For optimal play, print them in A3 & 
laminate them to allow participants to drawn on the images.

### 2. Install and build

```bash
uv sync --all-packages                  # backend + cellpose-SAM (cellpose 4) + ngio + the waldog CLI
cd frontend && npm install && npm run build && cd ..
uv run scientifica-pipeline measure     # optional, ~40 s: per-cell scatter data (cells_nuclei.json)
```

`measure` reads the segmentation from the zarr and writes the per-ROI cell
tables the Explore "Measure" step plots; without it the app runs, the scatter is
just empty. The first cellpose-SAM run downloads the `cpsam_v2` weights
(~1.2 GB) into `~/.cellpose/models/`.

## Running at the booth

```bash
uv run scientifica-server    # serves everything on http://<laptop-ip>:8100
```

- **TV**: open `http://<laptop-ip>:8100/tv` in a fullscreen browser (kiosk mode).
- **Laptop**: `http://localhost:8100/admin` — everything lives here: the Game tab
  (six player lanes with their own stopwatches, entries, leaderboard preview) and the
  Explore tab (analysis panel; "Broadcast to TV" mirrors it). TV scene, language
  (DE/EN/IT/FR, DE+EN, or auto-rotate) and theme (light/dark) sit in the
  always-visible controls row.

Playing: up to six people play at once, one per **lane**. Give each lane a player
name and a field (or "Custom" with a typed true count); the TV shows one tile per
filled lane — field image, name and its own stopwatch — in a grid that adapts to
the number of players. **▶ Start all** starts every armed lane on the same clock,
or start lanes one by one. **Stop** each player when they call it: their clock
freezes, prefilling the time; type their count and **Submit** to score and reveal
on the leaderboard (the TV returns to the grid by itself while others are still
counting). A finished lane keeps showing ✓ score on the TV until **Next player**
frees it for the next person — lanes are independent, so new players can start
while others are mid-count.

The TV needs no interaction: scenes (idle / explore / game / leaderboard /
podium) are switched from the admin page, and it reconnects by itself if the
server restarts.

## Data model

- The dashboard ROIs are the rows of `tables/scientifica_ROI_table_v3` (ids
  `roi_0`…`roi_13`). Display names ("Field 1"…"Field 14") come from
  `ROI_NAMES` in `src/scientifica/config.py` (transcribed from ROI_naming.xlsx;
  the index is not the field number) and the manifest is sorted by field number.
  `roi_12` is the hero (★ Field 14, the large overview region).
- Every coordinate the app handles (bboxes, cells, drawn regions, the mirrored
  view) is a level-0 pixel of the whole well; the viewer streams the zarr
  directly and confines the camera to the ROI bbox.
- Channel colours, display windows and default visibility come from the store's
  omero metadata — edit them there and run `measure` + `posters` to propagate.
- Live re-segmentations (Explore → "Re-segment") are written into the same store
  as `labels/live_<roi>_<job>` (3 newest per ROI are kept).

## Game truth

`data/derived/game.json` is the editable source of truth for the game — one
entry per ROI with the `id`, the shown `name` and `true_count` (seeded from the
cellpose count; `cellpose_count` / `cellpose_seconds` are kept alongside for
reference):

```json
{ "id": "roi_3", "name": "Field 3", "true_count": 131, "cellpose_count": 131, "cellpose_seconds": 3.6 }
```

The server re-reads the file when it changes (no restart), and
`scientifica-pipeline measure` refreshes only the `cellpose_*` columns — an
edited `true_count` is never overwritten. `scientifica.toml` `[truth_overrides]`
is an emergency knob that wins over the file.

## Scoring

`score = max_score × exp(−|guess − true| / (sigma × true)) × exp(−seconds / (tau × true))`

Both factors are normalized by the true count, so small and large images play on
the same scale: accuracy uses relative error, and the time budget is `tau`
seconds per cell. Accuracy dominates; a perfect count beats a fast sloppy one.

The parameters (`max_score`, `sigma`, `tau`) live in `scientifica.toml` and are
picked up on edit, no restart needed. With the defaults (sigma 0.2, tau 6.0) a
perfect 100/100 in 30 s scores 951.

Entries are stored in `data/game.db` (SQLite) — delete the file to reset the
leaderboard.

## Recomputing (pipeline)

`uv run scientifica-pipeline <command>`:

| command | when | time |
|---|---|---|
| `clean --backup [--drop-labels]` | only on a raw delivery: drops unused tables, `.DS_Store`, old derived dirs (backup to `data/source/_backup_<ts>/`) | seconds |
| `rechunk [--chunk 512]` | image pyramid delivered with big chunks (stop the server first) | ~10 s |
| `segment [--only roi_3]` | recompute `labels/nuclei` with cellpose-SAM at native resolution (1024-px tiles + halo, stitched) | ~35 min on an M-series GPU; `--only` is a 20 s dry run |
| `benchmark [--include-hero]` | per-ROI timing shown on the TV ("found N cells in X s"); the hero is extrapolated unless `--include-hero` (~25 min) | ~4 min |
| `measure` | `tables/nuclei_features`, per-ROI `cells_nuclei.json`, `manifest.json`, `game.json` (merges) | ~40 s |
| `posters` | per-ROI `display.jpg` / `enhanced.jpg` / `outlines.png` for the TV idle show and the game | ~10 s |
| `prune-live` | delete every live re-segmentation from the store | seconds |
| `all` | `segment → measure → posters` | |

Environment knobs: `SCIENTIFICA_CPSAM_MODEL` (default `cpsam_v2`),
`SCIENTIFICA_CPSAM_BF16=0` if MPS refuses bfloat16.

Static serving: image chunks are cached for a day by the browser; everything
that is rewritten in place (labels, zarr metadata, JSON, posters) is served
`no-cache`, so pipeline results show up on the next reload.

## Where's Waldog prints

```bash
uv run --package waldog waldog --seed 42            # random puzzle + solution per ROI (1, 7, 13)
uv run --package waldog waldog render --plan waldog/plans/roi_7.json   # the curated booth prints
```

Hides the pet cutouts from `waldog/waldog-pets/` in the 3-color renders in
`data/source/waldog/roi_NN.png` (not in git) and writes
`waldog/output/wheres_waldog_roi_<n>{,_solution}.png` at print resolution. The
committed plans in `waldog/plans/` are the source of truth for the prints; see
`waldog/README.md`.

## Development

```bash
uv run scientifica-server            # backend :8100
cd frontend && npm run dev           # Vite dev server :5173 (proxies /api, /assets, /ws)
```

Frontend details (stack, layout, gotchas) are in `frontend/README.md`.
