"""Offline pipeline over the whole-well OME-Zarr (ngio + cellpose-SAM).

    uv run scientifica-pipeline clean [--backup] [--dry-run]   drop unused tables, .DS_Store, old derived dirs
    uv run scientifica-pipeline prune-live [--dry-run]          drop every live_* label/table/cells json
    uv run scientifica-pipeline segment [--only roi_3] [...]   labels/nuclei for the whole well (cpsam, native res)
    uv run scientifica-pipeline benchmark                      time cellpose-SAM per ROI (TV "in X s")
    uv run scientifica-pipeline measure                        tables/nuclei_features + per-ROI cells json + manifest
    uv run scientifica-pipeline posters [--only roi_3]         per-ROI display/enhanced/outlines posters
    uv run scientifica-pipeline all                            segment -> measure -> posters

ROIs come from tables/<ROI_TABLE>; ids are its FieldIndex values (roi_0..).
Every coordinate the dashboard sees is a level-0 pixel of the whole well.
"""

import argparse
import json
import math
import shutil
import threading
import time
from datetime import datetime, timezone

import numpy as np
from ngio import SegmentationIterator
from ngio.iterators import StitchConfig, ThreadedMapper
from PIL import Image

from scientifica import config
from scientifica.analysis import measure, render, store
from scientifica.analysis.io import label_crop_at_level, poster_from_pyramid

BENCH_PATH = config.DERIVED_DIR / "benchmarks.json"


def _log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


# --- clean ------------------------------------------------------------------

def cmd_clean(args) -> None:
    root = config.zarr_path()
    ds = [p for p in root.rglob(".DS_Store")]
    _log(f".DS_Store files: {len(ds)}")
    if not args.dry_run:
        for p in ds:
            p.unlink()

    ome = store.open_container()
    keep_tables = set(config.KEEP_TABLES) | ({f"{config.CURATED_LABEL}_features"} if not args.drop_labels else set())
    tables = [t for t in ome.list_tables() if t not in keep_tables]
    labels = [lab for lab in ome.list_labels() if args.drop_labels or lab != config.CURATED_LABEL]
    _log(f"tables to delete: {tables}")
    _log(f"labels to delete: {labels}")
    if args.backup and not args.dry_run and (tables or labels):
        dest = config.SOURCE_DIR / f"_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        for sub in ("tables", "labels"):
            if (root / sub).is_dir():
                shutil.copytree(root / sub, dest / sub, ignore=shutil.ignore_patterns(".DS_Store"))
        _log(f"backup of tables/ + labels/ written to {dest}")
    if not args.dry_run:
        for t in tables:
            ome.delete_table(t, missing_ok=True)
        for lab in labels:
            ome.delete_label(lab, missing_ok=True)

    boxes = store.roi_boxes(ome, refresh=True)
    stale = [
        p for p in config.DERIVED_DIR.iterdir()
        if p.is_dir() and p.name not in boxes and (p.name.startswith("roi_") or p.name == "_live")
    ] if config.DERIVED_DIR.is_dir() else []
    _log(f"stale derived dirs: {[p.name for p in stale]}")
    if not args.dry_run:
        for p in stale:
            shutil.rmtree(p, ignore_errors=True)
    _log("clean: done" + (" (dry run)" if args.dry_run else ""))


def cmd_prune_live(args) -> None:
    """Delete every live re-segmentation (labels, tables, cells json)."""
    ome = store.open_container()
    names = [n for n in ome.list_labels() if n.startswith(config.LIVE_LABEL_PREFIX)]
    orphans = [t for t in ome.list_tables() if t.startswith(config.LIVE_LABEL_PREFIX)]
    files = list(config.DERIVED_DIR.glob(f"*/cells_{config.LIVE_LABEL_PREFIX}*.json"))
    _log(f"live labels: {names}")
    _log(f"live tables: {len(orphans)}, cells files: {len(files)}")
    if args.dry_run:
        return
    for name in names:
        image_id = name[len(config.LIVE_LABEL_PREFIX):].rsplit("_", 1)[0]
        store.discard_live(ome, image_id, name)
    for t in orphans:  # tables whose label is already gone
        ome.delete_table(t, missing_ok=True)
    for f in files:
        f.unlink(missing_ok=True)
    _log("prune-live: done")


# --- rechunk ----------------------------------------------------------------

def cmd_rechunk(args) -> None:
    """Rewrite the image pyramid with small chunks (viewer tiles = chunks).

    The delivery uses 2160x2560 chunks (5-7 MB each): every Viv tile pulled
    and decoded several of them on the main thread. Idempotent: levels that
    already have the target chunks are skipped. Stop the server first.
    """
    import os

    import zarr

    root = config.zarr_path()
    g = zarr.open_group(root, mode="r+", zarr_format=2)
    size = args.chunk
    for lvl in [d["path"] for d in g.attrs["multiscales"][0]["datasets"]]:
        src = g[lvl]
        if tuple(src.chunks[-2:]) == (size, size):
            _log(f"  level {lvl}: already {size}x{size}")
            continue
        tmp_name = f"_rechunk_{lvl}"
        chunks = (1,) * (src.ndim - 2) + (size, size)
        tmp = zarr.create_array(
            store=root, name=tmp_name, shape=src.shape, chunks=chunks, dtype=src.dtype,
            compressors=src.compressors, fill_value=src.fill_value, zarr_format=2,
            chunk_key_encoding={"name": "v2", "separator": "/"}, overwrite=True,
        )
        t0 = time.time()
        rows = src.chunks[-2]
        for c in range(src.shape[0]):
            for y0 in range(0, src.shape[-2], rows):
                y1 = min(src.shape[-2], y0 + rows)
                tmp[c, ..., y0:y1, :] = src[c, ..., y0:y1, :]
        del tmp
        shutil.rmtree(root / lvl)
        os.rename(root / tmp_name, root / lvl)
        _log(f"  level {lvl}: {src.shape} rechunked to {chunks} in {time.time() - t0:.0f}s")
    _log("rechunk: done")


# --- segment ----------------------------------------------------------------

def _stitch_block_size(tile: int, halo: int, diameter: float) -> int:
    tile_area = (tile + 2 * halo) ** 2
    cell_area = math.pi * (diameter / 2) ** 2
    return int(max(10_000, 4 * tile_area / cell_area))


def cmd_segment(args) -> None:
    from scientifica.analysis import segment

    ome = store.open_container()
    boxes = store.roi_boxes(ome)
    if args.skip_segmentation and config.CURATED_LABEL in ome.list_labels():
        _log(f"labels/{config.CURATED_LABEL} exists, --skip-segmentation: nothing to do")
        return
    image = ome.get_image()
    label = ome.derive_label(
        config.CURATED_LABEL,
        channels_policy="squeeze",
        dtype="uint32",
        chunks=store.label_chunks(ome),
        overwrite=True,
    )
    diameter, tile = args.diameter, args.tile
    halo = int(max(32, math.ceil(2 * diameter / 16) * 16))
    it = SegmentationIterator(
        image, label,
        channel_selection=config.CHANNEL_DEFS[config.NUCLEI_CHANNEL],
        axes_order=["y", "x"],
        consolidation_mode="auto",
    )
    if args.only:
        it = it.product([boxes[args.only].to_roi(ome)])
    it = it.by_grid(size_x=tile, size_y=tile, tail="balance").with_halo(x=halo, y=halo)
    total = len(it.rois)
    if total > 1:
        block = _stitch_block_size(tile, halo, diameter)
        it = it.with_stitch(StitchConfig(block_size=block, iou_threshold=0.3, scratch_store=None))
        _log(f"stitching enabled: block_size={block}")
    _log(f"segmenting {'ROI ' + args.only if args.only else 'the whole well'}: "
         f"{total} tiles of {tile}px (+{halo} halo), diameter {diameter}px, niter {args.niter}")

    done = 0
    lock = threading.Lock()
    t0 = time.time()

    def tick() -> None:
        nonlocal done
        with lock:
            done += 1
            n = done
        el = time.time() - t0
        eta = el / n * (total - n)
        _log(f"  tile {n}/{total}  elapsed {el / 60:.1f} min  eta {eta / 60:.1f} min")

    func = segment.make_tile_segmenter(
        "cellpose", diameter, 50, store.channel_windows(ome)[config.NUCLEI_CHANNEL],
        config.DEFAULTS["denoise"]["method"], config.DEFAULTS["denoise"]["strength"],
        on_tile=tick, niter=args.niter,
    )
    it.segment(func, mapper=ThreadedMapper(config.CELLPOSE_WORKERS))
    seconds = round(time.time() - t0, 1)
    count = int(ome.get_label(config.CURATED_LABEL).get_as_dask().max().compute())
    _log(f"segmentation done: {count} objects in {seconds / 60:.1f} min")

    bench = json.loads(BENCH_PATH.read_text()) if BENCH_PATH.exists() else {}
    bench[args.only or "well"] = seconds
    config.DERIVED_DIR.mkdir(parents=True, exist_ok=True)
    BENCH_PATH.write_text(json.dumps(bench, indent=1))


# --- benchmark --------------------------------------------------------------

def cmd_benchmark(args) -> None:
    """Time a cellpose-SAM run per ROI (what the TV shows as "found N cells in X s").

    Standard fields run exactly like a live job (one seamless call); the hero
    is extrapolated from the whole-well run by area unless --include-hero.
    Results land in benchmarks.json and are picked up by `measure`.
    """
    from scientifica.analysis import segment

    ome = store.open_container()
    boxes = store.roi_boxes(ome)
    image = ome.get_image()
    h, w = store.image_shape_yx(ome)
    bench = json.loads(BENCH_PATH.read_text()) if BENCH_PATH.exists() else {}
    window = store.channel_windows(ome)[config.NUCLEI_CHANNEL]
    ids = [args.only] if args.only else store.roi_ids_sorted(boxes)
    for rid in ids:
        box = boxes[rid]
        if rid in config.HERO_IDS and not args.include_hero:
            if "well" in bench:
                bench[rid] = round(bench["well"] * box.pixels / (w * h), 1)
                _log(f"  {rid}: {bench[rid]}s (extrapolated from the whole-well run)")
            continue
        label = ome.derive_label(
            "_bench", channels_policy="squeeze", dtype="uint32",
            chunks=store.label_chunks(ome), overwrite=True,
        )
        it = SegmentationIterator(
            image, label, channel_selection=config.CHANNEL_DEFS[config.NUCLEI_CHANNEL],
            axes_order=["y", "x"], consolidation_mode="coarsen",
        ).product([box.to_roi(ome)])
        if box.width > config.LIVE_TILE or box.height > config.LIVE_TILE:
            halo = int(max(32, math.ceil(2 * args.diameter / 16) * 16))
            it = it.by_grid(size_x=config.LIVE_TILE, size_y=config.LIVE_TILE, tail="balance").with_halo(x=halo, y=halo)
            if len(it.rois) > 1:
                it = it.with_stitch(StitchConfig(block_size=_stitch_block_size(config.LIVE_TILE, halo, args.diameter)))
        func = segment.make_tile_segmenter("cellpose", args.diameter, 50, window, "gaussian", 1.5)
        t0 = time.time()
        it.segment(func, mapper=ThreadedMapper(config.CELLPOSE_WORKERS))
        bench[rid] = round(time.time() - t0, 1)
        ome.delete_label("_bench", missing_ok=True)
        _log(f"  {rid}: {bench[rid]}s ({len(it.rois)} tile(s))")
    config.DERIVED_DIR.mkdir(parents=True, exist_ok=True)
    BENCH_PATH.write_text(json.dumps(bench, indent=1))
    _log("benchmark: done — run `measure` to refresh the manifest")


# --- measure + manifest -----------------------------------------------------

def cmd_measure(args) -> None:
    ome = store.open_container()
    boxes = store.roi_boxes(ome)
    if args.provisional:
        _log("provisional manifest: no cells (label not measured yet)")
        cells: list[dict] = []
    else:
        if config.CURATED_LABEL not in ome.list_labels():
            raise SystemExit(f"labels/{config.CURATED_LABEL} missing — run `segment` first")
        t0 = time.time()
        table, cells = measure.measure_label(
            ome, config.CURATED_LABEL, None, config.SEG_DIAMETER_PX,
            mapper=ThreadedMapper(config.FEATURE_WORKERS),
        )
        ome.add_table(f"{config.CURATED_LABEL}_features", table, overwrite=True)
        _log(f"measured {len(cells)} objects ({time.time() - t0:.0f}s)")

    by_roi = measure.split_cells_by_roi(cells, boxes)
    bench = json.loads(BENCH_PATH.read_text()) if BENCH_PATH.exists() else {}
    previous = _previous_manifest()
    c, h, w = store.image_shape_cyx(ome)
    channels = store.channel_meta_records(ome)
    pixel_size = float(ome.get_image().pixel_size.x)
    images = []
    for rid in store.roi_ids_sorted(boxes):
        box = boxes[rid]
        roi_cells = by_roi[rid]
        cells_url = store.write_cells_json(rid, config.CURATED_LABEL, measure.FEATURE_KEYS, roi_cells)
        diameter = (
            round(float(np.median([x["equivalent_diameter"] for x in roi_cells])), 1) if roi_cells else None
        )
        prev = previous.get(rid, {})
        images.append(
            {
                "id": rid,
                "title": config.ROI_NAMES.get(rid, rid),
                "hero": rid in config.HERO_IDS,
                "bbox": box.as_dict(),
                "width": box.width,
                "height": box.height,
                "image_width": w,
                "image_height": h,
                "image_shape": [c, h, w],
                "zarr_url": config.zarr_url(),
                "pixel_size_um": pixel_size,
                "channels": channels,
                "labels": {
                    config.CURATED_LABEL: {
                        "name": config.CURATED_LABEL,
                        "url": store.label_url(config.CURATED_LABEL),
                        "cells_url": cells_url,
                        "cell_count": len(roi_cells),
                    }
                },
                "cell_count": len(roi_cells),
                "diameter_px": diameter,
                "cellpose_seconds": bench.get(rid, prev.get("cellpose_seconds")),
                "assets": {
                    "display": f"/assets/{rid}/display.jpg",
                    "enhanced": f"/assets/{rid}/enhanced.jpg",
                    "outlines": f"/assets/{rid}/outlines.png",
                },
            }
        )
        _log(f"  {rid} ({images[-1]['title']}): {len(roi_cells)} cells, median diameter {diameter}px")

    # buttons are shown in this order: by field number ("Field 7" after "Field 6"),
    # not by the table's index (roi_12 is Field 14, roi_13 is Field 13)
    def field_no(e: dict) -> int:
        try:
            return int(e["title"].split()[-1])
        except (ValueError, IndexError):
            return 10**6

    images.sort(key=field_no)

    defaults = dict(config.DEFAULTS)
    diameters = [e["diameter_px"] for e in images if not e["hero"] and e["diameter_px"]]
    defaults["diameter_px"] = round(float(np.median(diameters)), 1) if diameters else config.SEG_DIAMETER_PX
    manifest = {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "defaults": defaults,
        "zarr_url": config.zarr_url(),
        "image_shape": [c, h, w],
        "image_width": w,
        "image_height": h,
        "pixel_size_um": pixel_size,
        "channels": channels,
        "images": images,
    }
    config.MANIFEST_PATH.write_text(json.dumps(manifest, indent=1))
    _log(f"manifest written: {len(images)} images, default diameter {defaults['diameter_px']}px")
    _write_game_json(images)


def _write_game_json(images: list[dict]) -> None:
    """The game's ground truth, kept apart from the cellpose results.

    One entry per ROI with the id, the shown name and `true_count`. New
    entries start from the cellpose count; an existing `true_count` is never
    overwritten (edit it by hand), while the cellpose columns are refreshed.
    """
    previous: dict[str, dict] = {}
    if config.GAME_PATH.exists():
        try:
            previous = {r["id"]: r for r in json.loads(config.GAME_PATH.read_text()).get("rois", [])}
        except (json.JSONDecodeError, KeyError, TypeError):
            _log(f"warning: {config.GAME_PATH.name} unreadable, rebuilding it")
    rois = []
    for img in images:
        prev = previous.get(img["id"], {})
        rois.append(
            {
                "id": img["id"],
                "name": img["title"],
                "true_count": prev.get("true_count", img["cell_count"]),
                "cellpose_count": img["cell_count"],
                "cellpose_seconds": img["cellpose_seconds"],
            }
        )
    game = {
        "_help": (
            "Ground truth for the counting game. `true_count` is what guesses are scored "
            "against — edit it freely (the server re-reads this file when it changes). "
            "`cellpose_*` are the segmentation results for reference and are refreshed by "
            "`scientifica-pipeline measure`, which never touches an existing `true_count`."
        ),
        "rois": rois,
    }
    config.GAME_PATH.write_text(json.dumps(game, indent=1))
    changed = [r["id"] for r in rois if r["true_count"] != r["cellpose_count"]]
    _log(f"game truth written: {config.GAME_PATH}" + (f" (hand-edited: {changed})" if changed else ""))


def _previous_manifest() -> dict[str, dict]:
    if not config.MANIFEST_PATH.exists():
        return {}
    try:
        return {img["id"]: img for img in json.loads(config.MANIFEST_PATH.read_text()).get("images", [])}
    except (json.JSONDecodeError, KeyError):
        return {}


# --- posters ----------------------------------------------------------------

def cmd_posters(args) -> None:
    ome = store.open_container()
    boxes = store.roi_boxes(ome)
    ids = [args.only] if args.only else store.roi_ids_sorted(boxes)
    has_label = config.CURATED_LABEL in ome.list_labels() and not args.no_outlines
    for rid in ids:
        box = boxes[rid]
        out_dir = config.roi_dir(rid)
        out_dir.mkdir(parents=True, exist_ok=True)
        rgb, level = poster_from_pyramid(ome, box, config.DISPLAY_LONG_SIDE)
        Image.fromarray(rgb).save(out_dir / "enhanced.jpg", quality=90)
        Image.fromarray(rgb).save(out_dir / "display.jpg", quality=90)
        if has_label:
            lab = label_crop_at_level(ome, config.CURATED_LABEL, box, level)
            outlines = render.render_outlines(lab)
            render.downscale_rgba(outlines, (rgb.shape[1], rgb.shape[0])).save(
                out_dir / "outlines.png", optimize=True
            )
        _log(f"  {rid}: posters at level {level} ({rgb.shape[1]}x{rgb.shape[0]})")


# --- CLI --------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("clean", help="remove unused tables/labels/.DS_Store from the source store")
    p.add_argument("--backup", action="store_true", help="copy tables/ and labels/ aside first")
    p.add_argument("--drop-labels", action="store_true", help="also delete labels/nuclei + its features")
    p.add_argument("--dry-run", action="store_true")

    p = sub.add_parser("prune-live", help="delete all live re-segmentation results from the store")
    p.add_argument("--dry-run", action="store_true")

    p = sub.add_parser("rechunk", help="rewrite the image pyramid with viewer-sized chunks")
    p.add_argument("--chunk", type=int, default=512)

    p = sub.add_parser("segment", help="cellpose-SAM segmentation of the whole well")
    p.add_argument("--only", help="restrict to one ROI id (dry run), e.g. roi_3")
    p.add_argument("--skip-segmentation", action="store_true", help="keep an existing labels/nuclei")
    p.add_argument("--diameter", type=float, default=config.SEG_DIAMETER_PX)
    p.add_argument("--niter", type=int, default=config.SEG_NITER)
    p.add_argument("--tile", type=int, default=config.SEG_TILE)

    p = sub.add_parser("benchmark", help="time cellpose-SAM per ROI (cellpose_seconds on the TV)")
    p.add_argument("--only")
    p.add_argument("--include-hero", action="store_true", help="really run the hero (~30 min) instead of extrapolating")
    p.add_argument("--diameter", type=float, default=config.SEG_DIAMETER_PX)

    p = sub.add_parser("measure", help="features table, per-ROI cells json, manifest")
    p.add_argument("--provisional", action="store_true", help="manifest without measuring (label not ready)")

    p = sub.add_parser("posters", help="per-ROI display/enhanced/outlines posters")
    p.add_argument("--only")
    p.add_argument("--no-outlines", action="store_true", help="images only (label not ready yet)")

    p = sub.add_parser("all", help="segment -> measure -> posters")
    p.add_argument("--skip-segmentation", action="store_true")
    p.add_argument("--diameter", type=float, default=config.SEG_DIAMETER_PX)
    p.add_argument("--niter", type=int, default=config.SEG_NITER)
    p.add_argument("--tile", type=int, default=config.SEG_TILE)

    args = parser.parse_args()
    if not hasattr(args, "no_outlines"):
        args.no_outlines = False
    if not hasattr(args, "provisional"):
        args.provisional = False
    config.DERIVED_DIR.mkdir(parents=True, exist_ok=True)
    if args.cmd == "clean":
        cmd_clean(args)
    elif args.cmd == "prune-live":
        cmd_prune_live(args)
    elif args.cmd == "rechunk":
        cmd_rechunk(args)
    elif args.cmd == "segment":
        cmd_segment(args)
    elif args.cmd == "benchmark":
        cmd_benchmark(args)
    elif args.cmd == "measure":
        cmd_measure(args)
    elif args.cmd == "posters":
        cmd_posters(args)
    elif args.cmd == "all":
        args.only = None
        cmd_segment(args)
        cmd_measure(args)
        cmd_posters(args)


if __name__ == "__main__":
    main()
