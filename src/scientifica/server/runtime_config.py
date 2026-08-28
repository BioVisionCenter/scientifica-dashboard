"""Runtime-tunable settings, reloaded on file change.

Unlike scientifica.config (code constants), these are meant to be edited
while the booth is running: scoring parameters (scientifica.toml) and the
per-ROI ground truth of the game (data/derived/game.json). A missing or
broken file falls back to the last good values.
"""

import copy
import json
import tomllib

from scientifica import config

CONFIG_PATH = config.PROJECT_ROOT / "scientifica.toml"

_DEFAULTS = {
    "scoring": {"max_score": 1000, "sigma": 0.2, "tau": 6.0},
    "truth_overrides": {},
}

_cache: dict = {"mtime": None, "data": copy.deepcopy(_DEFAULTS)}


def get() -> dict:
    """Current merged config; re-reads the TOML when its mtime changes."""
    try:
        mtime = CONFIG_PATH.stat().st_mtime
    except OSError:
        return _cache["data"]
    if mtime == _cache["mtime"]:
        return _cache["data"]
    try:
        with open(CONFIG_PATH, "rb") as f:
            raw = tomllib.load(f)
    except tomllib.TOMLDecodeError as exc:
        print(f"[runtime_config] ignoring broken {CONFIG_PATH.name}: {exc}")
        _cache["mtime"] = mtime  # don't re-parse until it changes again
        return _cache["data"]
    data = copy.deepcopy(_DEFAULTS)
    data["scoring"].update(raw.get("scoring", {}))
    data["truth_overrides"] = {str(k): int(v) for k, v in raw.get("truth_overrides", {}).items()}
    _cache.update(mtime=mtime, data=data)
    return data


def truth_override(image_id: str) -> int | None:
    return get()["truth_overrides"].get(image_id)


_game_cache: dict = {"mtime": None, "data": {}}


def game_truth(image_id: str) -> int | None:
    """`true_count` for a ROI from data/derived/game.json (re-read when it changes)."""
    path = config.GAME_PATH
    try:
        mtime = path.stat().st_mtime
    except OSError:
        return None
    if mtime != _game_cache["mtime"]:
        try:
            rois = json.loads(path.read_text()).get("rois", [])
            _game_cache["data"] = {
                str(r["id"]): int(r["true_count"]) for r in rois if r.get("true_count") is not None
            }
            _game_cache["mtime"] = mtime
        except (json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
            print(f"[runtime_config] ignoring broken {path.name}: {exc}")
            _game_cache["mtime"] = mtime
    return _game_cache["data"].get(image_id)
