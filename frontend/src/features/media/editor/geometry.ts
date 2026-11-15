/**
 * B11 picture editor maths. The editor shows the picture turned and flipped ("displayed"
 * coordinates, full-resolution pixels of the result before cropping); the crop box and the
 * focal point live there. The API wants the crop box in the SOURCE picture's pixels (before
 * turning), applied as crop → rotate clockwise → flip, so the box is mapped back on save.
 * Coordinates are edges (0…width), not pixel centres, so mapping is exact.
 */

export type Rect = { x: number; y: number; w: number; h: number }
export type Point = { x: number; y: number }
export type Turn = 0 | 90 | 180 | 270
export type Orientation = { rotate: Turn; flipH: boolean; flipV: boolean }
export type Adjustments = { brightness: number; contrast: number; saturation: number }
export type Size = { w: number; h: number }

export const NO_ORIENTATION: Orientation = { rotate: 0, flipH: false, flipV: false }
export const NO_ADJUSTMENTS: Adjustments = { brightness: 0, contrast: 0, saturation: 0 }
export const ADJUST_MIN = -50
export const ADJUST_MAX = 50

/** Crop shapes offered to the shop owner; null = free. */
export const ASPECTS = [
  { key: 'free', label: 'Free', ratio: null },
  { key: '1:1', label: 'Square 1:1', ratio: 1 },
  { key: '4:5', label: 'Portrait 4:5', ratio: 4 / 5 },
  { key: '16:9', label: 'Wide 16:9', ratio: 16 / 9 },
  { key: '3:2', label: 'Photo 3:2', ratio: 3 / 2 },
] as const
export type AspectKey = (typeof ASPECTS)[number]['key']

export const aspectRatio = (key: AspectKey): number | null => ASPECTS.find((a) => a.key === key)?.ratio ?? null

/** Size of the turned picture. */
export function displayedSize(source: Size, rotate: Turn): Size {
  return rotate === 90 || rotate === 270 ? { w: source.h, h: source.w } : { ...source }
}

/** A source point as displayed (turned clockwise, then flipped). */
export function toDisplayed(p: Point, source: Size, o: Orientation): Point {
  const { w: W, h: H } = source
  let q: Point
  switch (o.rotate) {
    case 90:
      q = { x: H - p.y, y: p.x }
      break
    case 180:
      q = { x: W - p.x, y: H - p.y }
      break
    case 270:
      q = { x: p.y, y: W - p.x }
      break
    default:
      q = { ...p }
  }
  const d = displayedSize(source, o.rotate)
  return { x: o.flipH ? d.w - q.x : q.x, y: o.flipV ? d.h - q.y : q.y }
}

/** A displayed point back in the source picture. */
export function toSource(p: Point, source: Size, o: Orientation): Point {
  const { w: W, h: H } = source
  const d = displayedSize(source, o.rotate)
  const u = o.flipH ? d.w - p.x : p.x
  const v = o.flipV ? d.h - p.y : p.y
  switch (o.rotate) {
    case 90:
      return { x: v, y: H - u }
    case 180:
      return { x: W - u, y: H - v }
    case 270:
      return { x: W - v, y: u }
    default:
      return { x: u, y: v }
  }
}

function mapRect(r: Rect, map: (p: Point) => Point): Rect {
  const a = map({ x: r.x, y: r.y })
  const b = map({ x: r.x + r.w, y: r.y + r.h })
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }
}

export const rectToSource = (r: Rect, source: Size, o: Orientation): Rect => mapRect(r, (p) => toSource(p, source, o))
export const rectToDisplayed = (r: Rect, source: Size, o: Orientation): Rect => mapRect(r, (p) => toDisplayed(p, source, o))

/** Whole pixels inside the picture (what the API accepts). */
export function roundRect(r: Rect, bounds: Size): Rect {
  const x = Math.min(Math.max(0, Math.round(r.x)), bounds.w - 1)
  const y = Math.min(Math.max(0, Math.round(r.y)), bounds.h - 1)
  return { x, y, w: Math.max(1, Math.min(Math.round(r.w), bounds.w - x)), h: Math.max(1, Math.min(Math.round(r.h), bounds.h - y)) }
}

export const fullRect = (d: Size): Rect => ({ x: 0, y: 0, w: d.w, h: d.h })

export const isFullRect = (r: Rect, d: Size): boolean => Math.abs(r.x) < 0.5 && Math.abs(r.y) < 0.5 && Math.abs(r.w - d.w) < 0.5 && Math.abs(r.h - d.h) < 0.5

/** The largest box of this shape, centred (the whole picture when free). */
export function fitAspect(d: Size, ratio: number | null): Rect {
  if (ratio === null) return fullRect(d)
  const w = Math.min(d.w, d.h * ratio)
  const h = w / ratio
  return { x: (d.w - w) / 2, y: (d.h - h) / 2, w, h }
}

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max)

export function moveRect(r: Rect, dx: number, dy: number, d: Size): Rect {
  return { ...r, x: clamp(r.x + dx, 0, d.w - r.w), y: clamp(r.y + dy, 0, d.h - r.h) }
}

export type Handle = 'nw' | 'ne' | 'sw' | 'se'

/** Drags one corner (the opposite one stays), keeping the shape when one is chosen. */
export function resizeRect(r: Rect, handle: Handle, dx: number, dy: number, d: Size, ratio: number | null, min = 8): Rect {
  const west = handle === 'nw' || handle === 'sw'
  const north = handle === 'nw' || handle === 'ne'
  const anchor = { x: west ? r.x + r.w : r.x, y: north ? r.y + r.h : r.y }
  const corner = { x: clamp((west ? r.x : r.x + r.w) + dx, 0, d.w), y: clamp((north ? r.y : r.y + r.h) + dy, 0, d.h) }
  let w = Math.max(min, Math.abs(corner.x - anchor.x))
  let h = Math.max(min, Math.abs(corner.y - anchor.y))
  // Room towards the dragged side.
  const roomW = west ? anchor.x : d.w - anchor.x
  const roomH = north ? anchor.y : d.h - anchor.y
  w = Math.min(w, roomW)
  h = Math.min(h, roomH)
  if (ratio !== null) {
    if (w / h > ratio) w = h * ratio
    else h = w / ratio
  }
  return { x: west ? anchor.x - w : anchor.x, y: north ? anchor.y - h : anchor.y, w, h }
}

/** CSS that previews the adjustments exactly as the server applies them. */
export function filterCss(a: Adjustments): string | undefined {
  if (a.brightness === 0 && a.contrast === 0 && a.saturation === 0) return undefined
  return `brightness(${1 + a.brightness / 100}) contrast(${1 + a.contrast / 100}) saturate(${1 + a.saturation / 100})`
}

/** A displayed point as percent of the crop box (what the saved picture's focal point is). */
export function focalPercent(p: Point, crop: Rect): { x: number; y: number } {
  return {
    x: Math.round(clamp(((p.x - crop.x) / crop.w) * 100, 0, 100)),
    y: Math.round(clamp(((p.y - crop.y) / crop.h) * 100, 0, 100)),
  }
}

export type EditState = { orientation: Orientation; adjust: Adjustments; crop: Rect; focal: Point | null }

export type EditPayload = {
  crop?: Rect
  rotate: Turn
  flip_h: boolean
  flip_v: boolean
  brightness: number
  contrast: number
  saturation: number
  focal_x?: number
  focal_y?: number
}

export function hasPixelChanges(s: EditState, source: Size): boolean {
  const { orientation: o, adjust: a } = s
  return o.rotate !== 0 || o.flipH || o.flipV || a.brightness !== 0 || a.contrast !== 0 || a.saturation !== 0 || !isFullRect(s.crop, displayedSize(source, o.rotate))
}

/** `POST /media/{id}/edit` body for the editor state. */
export function editPayload(s: EditState, source: Size): EditPayload {
  const d = displayedSize(source, s.orientation.rotate)
  const payload: EditPayload = {
    rotate: s.orientation.rotate,
    flip_h: s.orientation.flipH,
    flip_v: s.orientation.flipV,
    ...s.adjust,
  }
  if (!isFullRect(s.crop, d)) payload.crop = roundRect(rectToSource(s.crop, source, s.orientation), source)
  if (s.focal) {
    const f = focalPercent(s.focal, s.crop)
    payload.focal_x = f.x
    payload.focal_y = f.y
  }
  return payload
}

export const turn = (r: Turn, by: 90 | -90): Turn => ((((r + by) % 360) + 360) % 360) as Turn

/**
 * Keeps the crop box and focal point on the same part of the picture when it is turned or
 * flipped; a crop shape that no longer fits is fitted again.
 */
export function reorient(s: EditState, source: Size, next: Orientation, ratio: number | null): EditState {
  const crop = rectToDisplayed(rectToSource(s.crop, source, s.orientation), source, next)
  const focal = s.focal ? toDisplayed(toSource(s.focal, source, s.orientation), source, next) : null
  const d = displayedSize(source, next.rotate)
  const fits = ratio === null || Math.abs(crop.w / crop.h - ratio) < 0.01
  return { ...s, orientation: next, crop: fits ? crop : fitAspect(d, ratio), focal }
}

/** The smallest rendition at least `min` px wide from a srcset, else the original. */
export function previewUrl(url: string, srcset: string, min = 1280): string {
  const candidates = srcset
    .split(',')
    .map((part) => part.trim().split(/\s+/))
    .map(([u, w]) => ({ url: u ?? '', w: Number.parseInt(w ?? '', 10) }))
    .filter((c) => c.url && Number.isFinite(c.w))
    .sort((a, b) => a.w - b.w)
  return candidates.find((c) => c.w >= min)?.url ?? url
}
