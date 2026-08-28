# Frontend

React 19 + TypeScript + Vite 8 (rolldown) + Tailwind 4. The viewer is deck.gl
9.3 with Viv 0.22 (`@hms-dbmi/viv`) streaming the OME-Zarr straight from the
backend; the per-cell scatter is plotly `scattergl`; state that has to reach
the TV goes through zustand and the websocket hub.

```bash
npm install
npm run dev        # :5173, proxies /api, /assets and /ws to the backend on :8100
npm run build      # tsc -b && vite build -> dist/ (served by FastAPI with SPA fallback)
npm run lint       # oxlint
```

Built assets go to `dist/app/` (not `dist/assets/`) because `/assets` is the
backend's data mount.

## Layout (`src/`)

| path | role |
|---|---|
| `routes/Admin.tsx`, `Explore.tsx`, `Tv.tsx` | the two pages; `Explore` renders identically on the TV as `<Explore mirror />`, driven by the synced `ExploreState` |
| `viewer/OmeZarrStage.tsx` | raw `<DeckGL>` + `OrthographicView` over the shared whole-well zarr, confined to the ROI bbox (fit / zoom / pan clamps in `view-math.ts`, scrim outside the bbox) |
| `viewer/layers/LabelLayer.ts` + `label-shader.ts` | integer label pyramid as fill / outline / highlight with pixel-exact picking |
| `viewer/useBBoxDraw.ts`, `layers/overlays.ts` | drag-to-draw region for live re-segmentation, region/bbox overlays |
| `components/` | params panels, scatter, TV scenes, leaderboard, shared bits |
| `api/` | REST client, websocket hook, the manifest / state types (`types.ts` is the contract with the backend) |
| `stores/appStore.ts` | connection, scene, language, theme, entries, explore sync, job progress |
| `copy.ts` | all TV copy in DE/EN/IT/FR |
| `styles/` | design tokens (`--ngio-*`, `--ccc-*`), themes |

## Gotchas

- Every coordinate is a global level-0 pixel of the well; `StageView`
  (`{cx, cy, zoomRel}`) is normalized by each screen's own bbox fit, which is
  what lets the TV mirror a different-sized viewport.
- `loadOmeZarr` needs an absolute URL (zarrita throws "Invalid URL" on
  `/assets/...`) — `getOmeZarr` resolves it and caches per URL.
- Colours read from CSS variables can be 3-digit hex in the production build
  (the minifier shortens `#ffaa00` to `#fa0`); go through `normalizeHex`.
- deck.gl transitions (fly-to) must not be interrupted by writing interpolated
  frames back into state, and a container resize must preserve the view, not
  refit — both used to cancel fly-tos.
- The operator never subscribes to its own `explore:sync` echo (feedback loop),
  and the scatter is rebuilt only when data/axes/theme change — selection uses
  `Plotly.restyle`.
