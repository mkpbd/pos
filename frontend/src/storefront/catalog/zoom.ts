/*
 * P1b lightbox zoom (pure, unit-tested). The photo is drawn at its fitted size inside a stage and
 * transformed by `translate(x, y) scale(scale)` with the origin at its top-left corner. Zooming keeps
 * the point under the cursor or fingers in place; panning never shows more than the photo's own
 * edges (a photo smaller than the stage stays centred on that axis).
 */

export type ZoomView = { scale: number; x: number; y: number }

/** The photo's fitted box inside the stage (CSS px): its offset from the stage's top-left and its size, and the stage size. */
export type ZoomBox = { left: number; top: number; width: number; height: number; stageWidth: number; stageHeight: number }

export const IDENTITY: ZoomView = { scale: 1, x: 0, y: 0 }
export const MIN_ZOOM = 1
export const MAX_ZOOM = 4
/** One step of the zoom buttons and the + / − keys. */
export const ZOOM_STEP = 1.5
/** Double-tap / double-click zoom. */
export const TAP_ZOOM = 2.5

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function axis(translate: number, size: number, offset: number, stage: number, scale: number): number {
  const scaled = size * scale
  // Smaller than the stage: centred. Larger: its edges never come inside the stage.
  if (scaled <= stage) return (stage - scaled) / 2 - offset
  return clamp(translate, stage - offset - scaled, -offset)
}

/** The view brought within bounds: scale in [1, MAX_ZOOM], the photo covering the stage where it can. */
export function clampView(view: ZoomView, box: ZoomBox): ZoomView {
  const scale = clamp(Number.isFinite(view.scale) ? view.scale : 1, MIN_ZOOM, MAX_ZOOM)
  if (scale === 1) return IDENTITY
  return { scale, x: axis(view.x, box.width, box.left, box.stageWidth, scale), y: axis(view.y, box.height, box.top, box.stageHeight, scale) }
}

/** Zooms by `factor` keeping the stage point (px, py) fixed. */
export function zoomAt(view: ZoomView, factor: number, px: number, py: number, box: ZoomBox): ZoomView {
  const scale = clamp(view.scale * factor, MIN_ZOOM, MAX_ZOOM)
  const k = scale / view.scale
  const qx = px - box.left
  const qy = py - box.top
  return clampView({ scale, x: qx - k * (qx - view.x), y: qy - k * (qy - view.y) }, box)
}

/** Zooms around the stage's centre (buttons and keys). */
export function zoomCentre(view: ZoomView, factor: number, box: ZoomBox): ZoomView {
  return zoomAt(view, factor, box.stageWidth / 2, box.stageHeight / 2, box)
}

/** Double tap / double click: zoom in at the point, or back to the fitted photo when zoomed. */
export function toggleZoom(view: ZoomView, px: number, py: number, box: ZoomBox): ZoomView {
  return view.scale > 1 ? IDENTITY : zoomAt(view, TAP_ZOOM, px, py, box)
}

/**
 * A pinch: the start view, the start midpoint and finger distance → the view now. The content point
 * that was under the start midpoint follows the current midpoint (zoom and pan in one gesture).
 */
export function pinchView(start: ZoomView, startMid: { x: number; y: number }, startDistance: number, mid: { x: number; y: number }, distance: number, box: ZoomBox): ZoomView {
  if (startDistance <= 0) return start
  const scale = clamp(start.scale * (distance / startDistance), MIN_ZOOM, MAX_ZOOM)
  const k = scale / start.scale
  return clampView({ scale, x: mid.x - box.left - k * (startMid.x - box.left - start.x), y: mid.y - box.top - k * (startMid.y - box.top - start.y) }, box)
}

/** A drag of a zoomed photo by (dx, dy). */
export function panView(start: ZoomView, dx: number, dy: number, box: ZoomBox): ZoomView {
  return clampView({ ...start, x: start.x + dx, y: start.y + dy }, box)
}

/** Wheel delta → zoom factor (one notch of a mouse wheel ≈ 1.2×; pixel deltas of trackpads scale smoothly). */
export function wheelFactor(deltaY: number, deltaMode = 0): number {
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY
  return Math.exp(-clamp(pixels, -300, 300) * 0.0015)
}
