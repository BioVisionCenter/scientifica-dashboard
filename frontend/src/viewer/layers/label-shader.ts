/** Fragment shader + uniform block for the label (segmentation) tiles. */

export const labelUniforms = {
  name: 'label',
  fs: `\
layout(std140) uniform labelUniforms {
  vec2 texel;
  vec2 lutSize;
  vec4 accent;
  vec4 accent2;
  vec4 outline;
  float edgeTexels;
  float mode;
  float selected;
  float hovered;
  float fillOpacity;
  float lineOpacity;
} label;
`,
  uniformTypes: {
    texel: 'vec2<f32>',
    lutSize: 'vec2<f32>',
    accent: 'vec4<f32>',
    accent2: 'vec4<f32>',
    outline: 'vec4<f32>',
    edgeTexels: 'f32',
    mode: 'f32',
    selected: 'f32',
    hovered: 'f32',
    fillOpacity: 'f32',
    lineOpacity: 'f32',
  },
} as const

export type LabelUniformProps = {
  texel: [number, number]
  lutSize: [number, number]
  accent: [number, number, number, number]
  accent2: [number, number, number, number]
  outline: [number, number, number, number]
  /** neighbour-sampling distance in tile texels (screen-space line thickness) */
  edgeTexels: number
  mode: number
  selected: number
  hovered: number
  fillOpacity: number
  lineOpacity: number
}

/** mode: 0 = categorical fill, 1 = outlines, 2 = hidden (highlights only) */
export const LABEL_FS = `\
#version 300 es
#define SHADER_NAME label-bitmap-layer-fragment-shader
precision highp float;

uniform sampler2D grayscaleTexture;
uniform sampler2D colorTexture;

in vec2 vTexCoord;
out vec4 fragColor;

vec3 packUVsIntoRGB(vec2 uv) {
  vec2 uv8bit = floor(uv * 256.);
  vec2 uvFraction = fract(uv * 256.);
  vec2 uvFraction4bit = floor(uvFraction * 16.);
  float fractions = uvFraction4bit.x + uvFraction4bit.y * 16.;
  return vec3(uv8bit, fractions) / 255.;
}

vec3 lut(float id) {
  float w = label.lutSize.x;
  float h = label.lutSize.y;
  float i = mod(id - 1.0, w * h);
  float x = (mod(i, w) + 0.5) / w;
  float y = (floor(i / w) + 0.5) / h;
  return texture(colorTexture, vec2(x, y)).rgb;
}

float idAt(vec2 uv) {
  return texture(grayscaleTexture, uv).r;
}

// Fraction of samples on two rings (radius r and r/2, in texels) whose label
// differs from this fragment's: a soft "distance to boundary" that turns the
// 1-px staircase of a nearest-sampled label map into an antialiased line.
float boundaryCoverage(vec2 uv, float id, vec2 rTex) {
  float diff = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = 0.7853981634 * float(i);
    vec2 d = vec2(cos(a), sin(a));
    if (abs(idAt(uv + d * rTex) - id) > 0.5) diff += 1.0;
    if (abs(idAt(uv + d * rTex * 0.5) - id) > 0.5) diff += 1.0;
  }
  return diff / 16.0;
}

void main() {
  float id = idAt(vTexCoord);
  bool fg = id > 0.5;
  bool isSel = fg && abs(id - label.selected) < 0.5;
  bool isHov = fg && abs(id - label.hovered) < 0.5;
  float edge = 0.0;
  if (fg && (label.mode > 0.5 || isSel || isHov)) {
    // coverage ramps from 0 (interior) to ~0.5 (on the boundary)
    edge = smoothstep(0.02, 0.18, boundaryCoverage(vTexCoord, id, label.texel * label.edgeTexels));
  }
  vec4 col = vec4(0.);
  if (fg) {
    if (label.mode < 0.5) {
      col = vec4(lut(id), label.fillOpacity);
    } else if (label.mode < 1.5) {
      col = vec4(label.outline.rgb, label.lineOpacity * edge);
    }
    if (isHov) col = mix(col, vec4(label.accent2.rgb, 1.0), edge);
    if (isSel) col = mix(vec4(label.accent.rgb, max(col.a, 0.28)), vec4(label.accent.rgb, 1.0), edge);
  }
  if (bool(picking.isActive)) {
    // every labelled pixel is pickable, whatever the display mode
    col.a = fg ? 1.0 : 0.0;
  }
  if (col.a <= 0.0) discard;
  fragColor = col;
  geometry.uv = vTexCoord;
  DECKGL_FILTER_COLOR(fragColor, geometry);
  if (bool(picking.isActive) && !bool(picking.isAttribute)) {
    fragColor.rgb = packUVsIntoRGB(vTexCoord);
  }
}
`

/** 256-entry categorical palette (golden-angle hues), index = (id - 1) % 256. */
export function buildLut(): { data: Uint8Array; width: number; height: number } {
  const n = 256
  const data = new Uint8Array(n * 4)
  for (let i = 0; i < n; i++) {
    const h = (i * 137.508) % 360
    const s = 0.62 + 0.18 * ((i * 7) % 3) / 2
    const l = 0.52 + 0.12 * ((i * 11) % 4) / 3
    const [r, g, b] = hslToRgb(h, s, l)
    data[i * 4] = r
    data[i * 4 + 1] = g
    data[i * 4 + 2] = b
    data[i * 4 + 3] = 255
  }
  return { data, width: n, height: 1 }
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}
