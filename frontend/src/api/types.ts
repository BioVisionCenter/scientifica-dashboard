export interface FeatureKey {
  key: string
  label: string
}

export interface Cell {
  label: number
  centroid: [number, number]
  bbox: [number, number, number, number]
  polygon: [number, number][]
  area: number
  equivalent_diameter: number
  perimeter: number
  eccentricity: number
  solidity: number
  mean_nuclei: number
  mean_membrane: number
  [key: string]: unknown
}

export interface FeaturesFile {
  features: FeatureKey[]
  cells: Cell[]
}

export interface ManifestImage {
  id: string
  title: string
  width: number
  height: number
  hero: boolean
  cell_count: number
  diameter_px: number
  assets: {
    raw: string
    enhanced: string
    outlines: string
    mask: string
    labels: string
  }
  features_url: string
}

export interface Defaults {
  denoise: { method: string; strength: number }
  stretch: [number, number]
  diameter_px: number
  sensitivity: number
}

export interface Manifest {
  generated: string
  defaults: Defaults
  images: ManifestImage[]
}

export interface GameImage {
  id: string
  image: string
  source_roi: string
  boss: boolean
}

export interface Entry {
  id: number
  name: string
  game_image_id: string
  guess: number
  time_seconds: number
  score: number
  rank: number
  created_at: string
}

export interface RevealPayload {
  entry: Entry
  rank: number
  total: number
  true_count: number
  guess: number
}

export type Scene = 'idle' | 'explore' | 'leaderboard' | 'podium'

export type ThemeMode = 'light' | 'dark'

export type PipelineStep = 'raw' | 'segmented' | 'measured'

export interface ExploreParams {
  diameter_px: number
  sensitivity: number
}

export interface RegionRect {
  x: number
  y: number
  width: number
  height: number
}

export interface LiveResult {
  count: number
  region: RegionRect | null
  outlines_url: string
  mask_url: string
  cells_url: string
}

/** Normalized viewer state: image-coord centre + zoom relative to fit. */
export interface StageView {
  cx: number
  cy: number
  zoomRel: number
}

/** The full explore UI state, serializable, mirrored operator -> TV. */
export interface ExploreState {
  imageId: string
  step: PipelineStep
  overlay: 'none' | 'outlines' | 'mask'
  xKey: string
  yKey: string
  selectedLabel: number | null
  hoveredLabel: number | null
  params: ExploreParams
  busy: boolean
  liveResult: LiveResult | null
  view: StageView | null
}
