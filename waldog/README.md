# Where's Waldog

Renders a multi-channel OME-Zarr fluorescence image into an RGB picture, then
hides background-removed cutouts of pet photos in it at random non-overlapping
spots, color-blended into the local background so they camouflage. Produces two
PNGs in `output/`: the puzzle (`wheres_waldog.png`) and an answer key with red
circles (`wheres_waldog_solution.png`).

## Run

From the repo root (this is a uv workspace member):

```bash
uv sync --all-packages          # once, to install waldog + deps
uv run --package waldog waldog [--zarr-path PATH] [--out-dir DIR] [--seed N]
```

The default `--zarr-path` points at sample data inside a local ngio checkout
(`~/Projects/OMEZarr/ngio/data/...-small-mip.zarr/B/03/0`); on any other
machine, pass the path to an OME-Zarr image that has channel metadata.

Difficulty knobs (`PET_SIZE_RANGE`, `PET_ALPHA`, `COLOR_BLEND`,
`MAX_PLACEMENT_TRIES`) are constants at the top of `src/waldog/main.py`.

## Pet photos

Photos live in `waldog-pets/` (committed, EXIF stripped). Background removal
results are cached in `waldog-pets/cutouts/` (gitignored). When a new photo is
added, the first run shells out to `uv tool run --from "rembg[cpu,cli]" rembg`
to build its cutout — that downloads a ~176 MB u2net model into the user-level
rembg cache on first use.
