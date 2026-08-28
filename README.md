# Scientifica bioimage dashboard

Event dashboard for the bioimage-analysis booth: an interactive analysis showcase
and a cell-counting game, shown fullscreen on a TV and driven from a laptop on
the same network. The admin picks a round image, the TV shows it with a
stopwatch, and the app records attempts, scores them, and animates the
leaderboard.

## One-time preparation

```bash
uv sync                                          # installs cellpose-SAM (cellpose 4), ngio, fastapi, everything
uv run scientifica-pipeline clean --backup       # strip unused tables/labels from the source OME-Zarr (once)
uv run scientifica-pipeline all                  # cellpose-SAM whole-well segmentation -> features -> manifest -> posters
cd frontend && npm install && npm run build
```

The single source of truth is the whole-well OME-Zarr
`data/source/Cardiomyocyte_mip_scientifica_2026.zarr` (all of `data/` is
gitignored): a 3-channel (DAPI, nanog, Lamin B1) 20480×19440 px pyramid at
0.1625 µm/px. It is served as-is under `/assets/source/…`; the dashboard ROIs
are the rows of its `tables/scientifica_ROI_table_v3` (ids `roi_0`…`roi_13`,
display names from `ROI_NAMES` in `src/scientifica/config.py`, transcribed from
ROI_naming.xlsx), and every coordinate the app uses is a level-0 pixel of that
image. The pipeline writes the segmentation into the store (`labels/nuclei`,
`tables/nuclei_features`) with ngio's tiled iterators + cellpose-SAM at native
resolution (~25 min on an M-series GPU; `segment --only roi_3` is a 20 s dry
run) and derives per-ROI `data/derived/roi_N/{cells_nuclei.json, display.jpg,
enhanced.jpg, outlines.png}` plus `manifest.json`. `cell_count` per ROI (the
game's ground truth) is the number of segmented nuclei whose centroid lies in
the ROI. `data/source/waldog/` (3-color renders) is only used by the waldog
prints.

## Running at the booth

```bash
uv run scientifica-server    # serves everything on http://<laptop-ip>:8100
```

- **TV**: open `http://<laptop-ip>:8100/tv` in a fullscreen browser (kiosk mode).
- **Laptop**: `http://localhost:8100/admin` — everything lives here: the Game tab
  (round control with the shared stopwatch, entries, leaderboard preview) and the
  Explore tab (analysis panel; "Broadcast to TV" mirrors it). TV scene, language
  (DE/EN/IT/FR, DE+EN, or auto-rotate) and theme (light/dark) sit in the
  always-visible controls row.

Playing a round: pick an image (or "Custom" with a typed true count), **Show on
TV**, then **Start** — the TV shows the full image and a stopwatch. **Stop**
freezes both clocks and prefills the entry's time; submit name + guess to score
and reveal on the leaderboard.

The TV needs no interaction: scenes (idle / explore / game / leaderboard /
podium) are switched from the admin page, and it reconnects by itself if the
server restarts.

## Scoring

`score = max_score × exp(−|guess − true| / (sigma × true)) × exp(−seconds / (tau × true))`

Both factors are normalized by the true count, so small and large images play on
the same scale: accuracy uses relative error, and the time budget is `tau`
seconds per cell. Accuracy dominates; a perfect count beats a fast sloppy one.

The parameters (`max_score`, `sigma`, `tau`) and per-image true-count overrides
live in `scientifica.toml` and are picked up on edit, no restart needed. With
the defaults (sigma 0.2, tau 6.0) a perfect 100/100 in 30 s scores 951.

Entries are stored in `data/game.db` (SQLite) — delete the file to reset the
leaderboard.

## Where's Waldog prints

```bash
uv run waldog --seed 42      # one puzzle + solution pair per waldog ROI (1, 7, 13)
```

Hides the pet cutouts from `waldog/waldog-pets/` in the 3-color ROI renders and
writes `waldog/output/wheres_waldog_roi_<n>{,_solution}.png` at print
resolution. Knobs: `--rois`, `--pet-scale`, `--seed`; difficulty constants sit
at the top of `waldog/src/waldog/main.py`.

## Development

```bash
uv run scientifica-server            # backend :8100
cd frontend && npm run dev           # Vite dev server :5173 (proxies /api, /assets, /ws)
```
