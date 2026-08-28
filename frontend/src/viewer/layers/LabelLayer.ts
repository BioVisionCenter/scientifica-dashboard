/**
 * Integer label pyramid rendered as categorical fill / outlines / highlights,
 * with pixel-exact picking from the loaded tile data. Ported from vizarr's
 * LabelLayer (BioNGFF/vizarr, MIT) for deck.gl 9 + a display-mode shader.
 */
import type { GetPickingInfoParams, Layer, LayerContext, PickingInfo, UpdateParameters } from '@deck.gl/core'
import { TileLayer } from '@deck.gl/geo-layers'
import { BitmapLayer, type BitmapLayerPickingInfo } from '@deck.gl/layers'
import type { Texture } from '@luma.gl/core'
import { LABEL_FS, buildLut, labelUniforms, type LabelUniformProps } from './label-shader'
import type { PixelData, ZarrLoader } from './viv-layers'

export type LabelMode = 'fill' | 'outline' | 'hidden'
export type RGBA = [number, number, number, number]

export interface LabelLayerProps {
  id: string
  loader: ZarrLoader
  mode: LabelMode
  selectedLabel: number | null
  hoveredLabel: number | null
  accent: RGBA
  accent2: RGBA
  /** outline colour (single colour for every cell) */
  outline: RGBA
  /** outline thickness in screen px */
  lineWidth?: number
  /** typical cell diameter in image px: outlines thin out when cells are tiny on screen */
  cellDiameter?: number
  fillOpacity?: number
  lineOpacity?: number
  pickable?: boolean
  onHover?: (info: LabelPickingInfo) => void
  onClick?: (info: LabelPickingInfo) => void
}

export type LabelPickingInfo = PickingInfo & { label?: number }
type TilePickingInfo = ReturnType<TileLayer<PixelData>['getPickingInfo']> & { label?: number }
type SubPickingInfo = BitmapLayerPickingInfo & { label?: number }

interface TileSubLayerProps {
  pixelData: PixelData
  colorTexture: Texture
  lutSize: [number, number]
  mode: LabelMode
  selectedLabel: number | null
  hoveredLabel: number | null
  accent: RGBA
  accent2: RGBA
  outline: RGBA
  lineWidth: number
  cellDiameter: number
  level: number
  fillOpacity: number
  lineOpacity: number
}

const MODE_INDEX: Record<LabelMode, number> = { fill: 0, outline: 1, hidden: 2 }

type LabelLayerState = { colorTexture?: Texture; lutSize?: [number, number] }

function labelSelection(loader: ZarrLoader): Record<string, number> {
  return Object.fromEntries(loader[0].labels.map((axis: string) => [axis, 0]))
}

// TileLayer's generics are loose enough that we type the props ourselves
export class LabelLayer extends TileLayer<PixelData> {
  static layerName = 'LabelLayer'
  labelProps: LabelLayerProps

  constructor(props: LabelLayerProps) {
    const { loader } = props
    const shape = loader[0].shape
    const width = shape[shape.length - 1]
    const height = shape[shape.length - 2]
    const selection = labelSelection(loader)
    // spread the display props into deck's props so a change (mode, selection,
    // colours) invalidates the cached tile sublayers
    const { loader: _loader, onHover: _h, onClick: _c, ...deckProps } = props
    super({
      ...deckProps,
      id: props.id,
      extent: [0, 0, width, height],
      tileSize: loader[0].tileSize,
      minZoom: -(loader.length - 1),
      maxZoom: 0,
      // parent tiles stay until the finer ones arrive (no gaps while zooming)
      refinementStrategy: 'best-available',
      maxRequests: 8,
      pickable: props.pickable ?? false,
      updateTriggers: { getTileData: [loader] },
      async getTileData({ index, signal }) {
        const { x, y, z } = index
        const source = loader[Math.round(-z)]
        const tile = await source.getTile({ x, y, selection, signal })
        return tile
      },
    })
    this.labelProps = props
  }

  private get labelState(): LabelLayerState {
    return this.state as unknown as LabelLayerState
  }

  updateState(params: UpdateParameters<this>): void {
    super.updateState(params)
    if (!this.labelState.colorTexture) {
      const lut = buildLut()
      this.setState({
        colorTexture: this.context.device.createTexture({
          width: lut.width,
          height: lut.height,
          data: lut.data,
          dimension: '2d',
          sampler: {
            minFilter: 'nearest',
            magFilter: 'nearest',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
          },
          format: 'rgba8unorm',
        }),
        lutSize: [lut.width, lut.height],
      })
    }
  }

  finalizeState(): void {
    this.labelState.colorTexture?.destroy()
    super.finalizeState()
  }

  getPickingInfo(params: GetPickingInfoParams): TilePickingInfo {
    // the sublayer already attached `label`; keep it on the way up
    const info = super.getPickingInfo(params) as TilePickingInfo
    const source = params.sourceLayer as unknown as { lastLabel?: number } | null
    if (source && source.lastLabel !== undefined) info.label = source.lastLabel
    return info
  }

  renderSubLayers(
    params: TileLayer['props'] & {
      data: PixelData
      tile: { index: { x: number; y: number; z: number }; boundingBox: [number[], number[]] }
    },
  ): Layer | null {
    const { tile, data } = params
    const p = { ...this.labelProps, ...(this.props as unknown as Partial<LabelLayerProps>) }
    const { colorTexture, lutSize } = this.labelState
    if (!data || !colorTexture || !lutSize) return null
    const [[left, minY], [right, maxY]] = tile.boundingBox
    const ext = this.props.extent as number[]
    const clampX = (v: number) => Math.min(ext[2], Math.max(0, v))
    const clampY = (v: number) => Math.min(ext[3], Math.max(0, v))
    return new LabelTileLayer({
      id: `${p.id}-tile-${tile.index.x}.${tile.index.y}.${tile.index.z}`,
      pixelData: data,
      colorTexture,
      lutSize,
      mode: p.mode,
      selectedLabel: p.selectedLabel,
      hoveredLabel: p.hoveredLabel,
      accent: p.accent,
      accent2: p.accent2,
      outline: p.outline,
      lineWidth: p.lineWidth ?? 2.5,
      cellDiameter: p.cellDiameter ?? 60,
      level: -tile.index.z,
      fillOpacity: p.fillOpacity ?? 0.38,
      lineOpacity: p.lineOpacity ?? 0.95,
      // image row 0 sits at minY (y grows downwards): [left, bottom, right, top]
      bounds: [clampX(left), clampY(maxY), clampX(right), clampY(minY)],
      image: new ImageData(Math.max(1, data.width), Math.max(1, data.height)),
      pickable: p.pickable ?? false,
      opacity: 1,
    })
  }
}

type SubLayerState = { texture?: Texture; model?: { shaderInputs: { setProps: (p: object) => void }; setBindings: (b: object) => void } }

export class LabelTileLayer extends BitmapLayer<TileSubLayerProps> {
  static layerName = 'LabelTileLayer'
  lastLabel: number | undefined

  private get subState(): SubLayerState {
    return this.state as unknown as SubLayerState
  }

  getShaders() {
    const shaders = super.getShaders()
    return { ...shaders, fs: LABEL_FS, modules: [...(shaders.modules ?? []), labelUniforms] }
  }

  getPickingInfo(params: GetPickingInfoParams): SubPickingInfo {
    const info = super.getPickingInfo(params) as SubPickingInfo
    this.lastLabel = undefined
    if (!info.coordinate) return info
    const { pixelData, bounds } = this.props
    const { data, width, height } = pixelData
    const [left, bottom, right, top] = bounds as number[]
    if (right - left === 0 || top - bottom === 0) return info
    const [x, y] = info.coordinate
    const normX = (x - left) / (right - left)
    const normY = (y - bottom) / (top - bottom)
    const px = Math.min(width - 1, Math.max(0, Math.floor(normX * width)))
    const py = Math.min(height - 1, Math.max(0, Math.floor((1 - normY) * height)))
    const label = Number((data as ArrayLike<number>)[py * width + px])
    info.label = label
    this.lastLabel = label
    return info
  }

  updateState(params: UpdateParameters<this>): void {
    super.updateState(params)
    const { props, oldProps } = params
    if (props.pixelData !== oldProps.pixelData) {
      this.subState.texture?.destroy()
      this.setState({
        texture: this.context.device.createTexture({
          width: props.pixelData.width,
          height: props.pixelData.height,
          // r32float + sampler2D: ANGLE workaround (vizarr); ids exact up to 2^24
          data: new Float32Array(props.pixelData.data as ArrayLike<number>),
          dimension: '2d',
          sampler: {
            minFilter: 'nearest',
            magFilter: 'nearest',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
          },
          format: 'r32float',
        }),
      })
    }
  }

  finalizeState(context: LayerContext): void {
    this.subState.texture?.destroy()
    super.finalizeState(context)
  }

  draw(opts: Parameters<BitmapLayer['draw']>[0]) {
    const { model, texture } = this.subState
    const p = this.props
    if (model && texture && p.colorTexture) {
      // screen px per tile texel = 2^(zoom + level); sample neighbours half
      // the line width away so the band straddling the boundary is ~lineWidth
      const zoom = (this.context.viewport as unknown as { zoom?: number }).zoom ?? 0
      const pxPerTexel = 2 ** (zoom + p.level)
      // cells only a few px wide: 1 px hairline, faded, so the field stays legible
      const cellPx = p.cellDiameter * 2 ** zoom
      const tiny = cellPx < 14
      const lineWidth = tiny ? 1 : p.lineWidth
      const lineFade = tiny ? Math.min(1, Math.max(0.3, (cellPx - 3) / 11)) : 1
      const edgeTexels = Math.min(6, Math.max(0.5, lineWidth / 2 / pxPerTexel))
      const uniforms: LabelUniformProps = {
        texel: [1 / p.pixelData.width, 1 / p.pixelData.height],
        lutSize: p.lutSize,
        accent: p.accent.map((v) => v / 255) as RGBA,
        accent2: p.accent2.map((v) => v / 255) as RGBA,
        outline: p.outline.map((v) => v / 255) as RGBA,
        edgeTexels,
        mode: MODE_INDEX[p.mode],
        selected: p.selectedLabel ?? -1,
        hovered: p.hoveredLabel ?? -1,
        fillOpacity: p.fillOpacity,
        lineOpacity: p.lineOpacity * lineFade,
      }
      model.shaderInputs.setProps({ label: uniforms })
      model.setBindings({ grayscaleTexture: texture, colorTexture: p.colorTexture })
    }
    super.draw(opts)
  }
}
