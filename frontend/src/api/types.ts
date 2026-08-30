export interface FeatureKey {
  key: string
  label: string
}

export interface Cell {
  label: number
  /** level-0 image px */
  centroid: [number, number]
  bbox: [number, number, number, number]
  area: number
  equivalent_diameter: number
  perimeter: number
  eccentricity: number
  solidity: number
  mean_nuclei: number
  mean_membrane: number
  [key: string]: unknown
}

export interface CellsFile {
  label: string
  features: FeatureKey[]
  cells: Cell[]
}

/** omero display window in raw dtype units */
export interface OmeroWindow {
  min: number
  max: number
  start: number
  end: number
}

export interface ChannelMeta {
  key: string
  label: string
  /** 'RRGGBB' */
  color: string
  window: OmeroWindow
  /** index on the zarr c axis */
  index: number
  /** omero `active`: shown by default */
  active?: boolean
}

/** Per-channel viewer settings; min/max window in raw dtype units. */
export interface ChannelSettings {
  visible: boolean
  color: string
  min: number
  max: number
}

export interface LabelMeta {
  name: string
  url: string
  cells_url: string
  cell_count: number
}

/** One dashboard ROI: a bbox of the shared whole-well OME-Zarr. Every
    coordinate (bbox, cells, regions, view centre) is a GLOBAL level-0 px. */
export interface ManifestImage {
  id: string
  title: string
  /** ROI size in level-0 px (== bbox.width/height) */
  width: number
  height: number
  /** ROI rectangle in global level-0 px of the shared zarr */
  bbox: RegionRect
  /** full shared image size, level-0 px */
  image_width: number
  image_height: number
  image_shape?: [number, number, number]
  hero: boolean
  zarr_url: string
  pixel_size_um: number
  /** legacy per-ROI store fields */
  rotated?: boolean
  levels?: number
  chunk?: number
  channels: ChannelMeta[]
  labels: { nuclei: LabelMeta } & Record<string, LabelMeta>
  cell_count: number
  /** median nucleus diameter in the ROI (null until measured) */
  diameter_px: number | null
  cellpose_seconds: number | null
  /** posters for the TV idle show / game */
  assets: {
    display: string
    enhanced: string
    outlines: string
  }
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
  zarr_url?: string
  image_width?: number
  image_height?: number
  pixel_size_um?: number
  channels?: ChannelMeta[]
  images: ManifestImage[]
}

export type LaneStatus = 'empty' | 'armed' | 'running' | 'stopped' | 'done'

/** One of the six independent game lanes: a player counting one field. */
export interface Lane {
  slot: number
  name: string
  image_id: string | null
  image_url: string | null
  image_title: string | null
  status: LaneStatus
  /** bumped on every start so clocks re-seed */
  run_id: number
  /** authoritative seconds once stopped / done */
  elapsed: number | null
  /** server-side elapsed at send time (running), else == elapsed */
  elapsed_now: number | null
  entry_id: number | null
  score: number | null
  rank: number | null
  /** name already on the board or on another active lane */
  name_taken: boolean
}

export interface LanesState {
  lanes: Lane[]
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

export type Scene = 'idle' | 'explore' | 'game' | 'leaderboard' | 'podium'

export type ThemeMode = 'light' | 'dark'

export type PipelineStep = 'raw' | 'segmented' | 'measured'

export type Segmenter = 'cellpose' | 'otsu'

export interface ExploreParams {
  diameter_px: number
  sensitivity: number
  segmenter: Segmenter
}

/** global level-0 px of the shared image */
export interface RegionRect {
  x: number
  y: number
  width: number
  height: number
}

export interface SegmentRequest {
  image_id: string
  region: RegionRect | null
  diameter_px: number
  sensitivity: number
  segmenter: Segmenter
  method?: string
  strength?: number
}

export type JobStage = 'queued' | 'preparing' | 'segmenting' | 'measuring' | 'done' | 'error' | 'cancelled'

export interface JobProgress {
  job_id: string
  stage: JobStage
  done: number
  total: number
}

export interface LiveResult {
  job_id: string
  image_id: string
  label: string
  label_url: string
  cells_url: string
  region: RegionRect | null
  count: number
  seconds: number
}

export interface Job {
  status: 'running' | 'done' | 'error' | 'cancelled'
  stage: JobStage
  done: number
  total: number
  result: LiveResult | null
  error?: string
}

export type OverlayMode = 'none' | 'outlines' | 'mask'

/** Normalized viewer state: global image-px centre + zoom relative to the ROI-bbox fit. */
export interface StageView {
  cx: number
  cy: number
  zoomRel: number
}

/** The full explore UI state, serializable, mirrored operator -> TV. */
export interface ExploreState {
  imageId: string
  step: PipelineStep
  overlay: OverlayMode
  xKey: string
  yKey: string
  selectedLabel: number | null
  hoveredLabel: number | null
  params: ExploreParams
  channels: Record<string, ChannelSettings>
  busy: boolean
  liveResult: LiveResult | null
  view: StageView | null
  /** drawn bbox for live re-segmentation (null = whole image) */
  region: RegionRect | null
  drawMode: boolean
}
