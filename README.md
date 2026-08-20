# Scientifica bioimage dashboard

Event dashboard for the bioimage-analysis booth: an interactive analysis showcase
and a cell-counting game leaderboard, shown fullscreen on a TV and driven from a
laptop on the same network. The counting itself happens on printed sheets; this
app records attempts, scores them, and animates the leaderboard.

## One-time preparation

```bash
uv sync                      # installs cellpose, fastapi, everything
uv run scientifica-pipeline  # ~5 min: crop, enhance, segment, measure all images
uv run scientifica-patches   # derive the game images + ground-truth counts
cd frontend && npm install && npm run build
```

Raw images live in `scietifica_data/`. Derived assets land in `data/derived/`
(gitignored). Print the game sheets from `data/derived/game/patch_*.jpg`.

## Running at the booth

```bash
uv run scientifica-server    # serves everything on http://<laptop-ip>:8100
```

- **TV**: open `http://<laptop-ip>:8100/tv` in a fullscreen browser (kiosk mode).
- **Laptop**: `http://localhost:8100/admin` — everything lives here: the Game tab
  (entries, stopwatch, leaderboard preview) and the Explore tab (analysis panel;
  "Broadcast to TV" mirrors it). TV scene, language (DE/EN/IT/FR, DE+EN, or auto-rotate) and theme
  (light/dark) sit in the always-visible controls row.

The TV needs no interaction: scenes (idle / explore / leaderboard / podium) are
switched from the admin page, and it reconnects by itself if the server restarts.

## Scoring

`score = 1000 × exp(−|guess − true| / (0.1 × true)) × exp(−seconds / true)`

Both factors are normalized by the true count, so small and large patches play
on the same scale: accuracy uses relative error, and the time budget is about
one second per cell. Accuracy dominates; a perfect count beats a fast sloppy one. Entries are
stored in `data/game.db` (SQLite) — delete the file to reset the leaderboard.

## Development

```bash
uv run scientifica-server            # backend :8100
cd frontend && npm run dev           # Vite dev server :5173 (proxies /api, /assets, /ws)
```
