"""Explore endpoints: pipeline manifest + TV scene state + explore mirroring."""

import json

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from scientifica import config
from scientifica.server.ws import hub

router = APIRouter(prefix="/api")

_tv_state = {"scene": "idle", "payload": {}, "lang": "bi", "theme": "dark"}

SCENES = ("idle", "explore", "game", "leaderboard", "podium")
LANGS = ("de", "en", "it", "fr", "bi", "rotate")
THEMES = ("light", "dark")


async def force_scene(scene: str, payload: dict | None = None) -> None:
    """Server-initiated scene switch (game rounds, entry reveals)."""
    _tv_state["scene"] = scene
    _tv_state["payload"] = payload or {}
    await hub.broadcast("scene:set", _tv_state)


@router.get("/manifest")
def manifest():
    if not config.MANIFEST_PATH.exists():
        raise HTTPException(503, "pipeline has not been run yet")
    with open(config.MANIFEST_PATH) as f:
        return json.load(f)


class SceneBody(BaseModel):
    scene: str
    payload: dict = {}


@router.get("/tv/scene")
def get_scene():
    return _tv_state


@router.post("/tv/scene")
async def set_scene(body: SceneBody):
    if body.scene not in SCENES:
        raise HTTPException(422, f"scene must be one of {SCENES}")
    _tv_state["scene"] = body.scene
    _tv_state["payload"] = body.payload
    await hub.broadcast("scene:set", _tv_state)
    return _tv_state


class LangBody(BaseModel):
    lang: str


@router.post("/tv/lang")
async def set_lang(body: LangBody):
    if body.lang not in LANGS:
        raise HTTPException(422, f"lang must be one of {LANGS}")
    _tv_state["lang"] = body.lang
    await hub.broadcast("lang:set", {"lang": body.lang})
    return _tv_state


class ThemeBody(BaseModel):
    theme: str


@router.post("/tv/theme")
async def set_theme(body: ThemeBody):
    if body.theme not in THEMES:
        raise HTTPException(422, f"theme must be one of {THEMES}")
    _tv_state["theme"] = body.theme
    await hub.broadcast("theme:set", {"theme": body.theme})
    return _tv_state


class ExploreState(BaseModel):
    """Free-form explore UI state mirrored from the operator to the TV."""

    state: dict


_explore_state: dict = {}


@router.post("/tv/explore-sync")
async def explore_sync(body: ExploreState):
    _explore_state.clear()
    _explore_state.update(body.state)
    await hub.broadcast("explore:sync", body.state)
    return {"ok": True}


@router.get("/tv/explore-state")
def get_explore_state():
    """Resync path for a TV that (re)connects mid-broadcast."""
    return _explore_state
