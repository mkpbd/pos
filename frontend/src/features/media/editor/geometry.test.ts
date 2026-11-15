import { describe, expect, it } from 'vitest'
import {
  displayedSize,
  editPayload,
  filterCss,
  fitAspect,
  focalPercent,
  fullRect,
  hasPixelChanges,
  moveRect,
  NO_ADJUSTMENTS,
  NO_ORIENTATION,
  previewUrl,
  rectToDisplayed,
  rectToSource,
  reorient,
  resizeRect,
  toDisplayed,
  toSource,
  turn,
  type Orientation,
} from './geometry'

const source = { w: 400, h: 200 }

describe('picture editor geometry', () => {
  it('turns clockwise like the server: the left side ends on top', () => {
    const o: Orientation = { rotate: 90, flipH: false, flipV: false }
    expect(displayedSize(source, 90)).toEqual({ w: 200, h: 400 })
    // Top-left corner of the source goes to the top-right.
    expect(toDisplayed({ x: 0, y: 0 }, source, o)).toEqual({ x: 200, y: 0 })
    // The left half (x < 200) is the top half once turned.
    expect(rectToDisplayed({ x: 0, y: 0, w: 200, h: 200 }, source, o)).toEqual({ x: 0, y: 0, w: 200, h: 200 })
    expect(rectToDisplayed({ x: 200, y: 0, w: 200, h: 200 }, source, o)).toEqual({ x: 0, y: 200, w: 200, h: 200 })
  })

  it('maps points and boxes back to the source for every turn and flip', () => {
    for (const rotate of [0, 90, 180, 270] as const) {
      for (const flipH of [false, true]) {
        for (const flipV of [false, true]) {
          const o = { rotate, flipH, flipV }
          const p = { x: 37, y: 120 }
          expect(toSource(toDisplayed(p, source, o), source, o)).toEqual(p)
          const r = { x: 10, y: 20, w: 100, h: 50 }
          expect(rectToSource(rectToDisplayed(r, source, o), source, o)).toEqual(r)
        }
      }
    }
  })

  it('builds the edit request with the crop in source pixels', () => {
    const o: Orientation = { rotate: 90, flipH: true, flipV: false }
    // Displayed 200 × 400; mirrored after turning, so the displayed left is the turned right.
    const crop = { x: 0, y: 0, w: 100, h: 200 }
    const payload = editPayload({ orientation: o, adjust: { brightness: 10, contrast: 0, saturation: -5 }, crop, focal: { x: 50, y: 50 } }, source)
    expect(payload).toEqual({ rotate: 90, flip_h: true, flip_v: false, brightness: 10, contrast: 0, saturation: -5, crop: { x: 0, y: 0, w: 200, h: 100 }, focal_x: 50, focal_y: 25 })
    // A box over the whole picture is no crop.
    const whole = editPayload({ orientation: NO_ORIENTATION, adjust: NO_ADJUSTMENTS, crop: fullRect(source), focal: null }, source)
    expect(whole).not.toHaveProperty('crop')
    expect(hasPixelChanges({ orientation: NO_ORIENTATION, adjust: NO_ADJUSTMENTS, crop: fullRect(source), focal: { x: 1, y: 1 } }, source)).toBe(false)
    expect(hasPixelChanges({ orientation: NO_ORIENTATION, adjust: NO_ADJUSTMENTS, crop: { x: 0, y: 0, w: 399, h: 200 }, focal: null }, source)).toBe(true)
  })

  it('fits, moves and resizes the crop box inside the picture, keeping its shape', () => {
    expect(fitAspect(source, 1)).toEqual({ x: 100, y: 0, w: 200, h: 200 })
    expect(fitAspect(source, null)).toEqual(fullRect(source))
    expect(moveRect({ x: 100, y: 0, w: 200, h: 200 }, 500, 10, source)).toEqual({ x: 200, y: 0, w: 200, h: 200 })
    expect(moveRect({ x: 100, y: 0, w: 200, h: 200 }, -500, 0, source)).toEqual({ x: 0, y: 0, w: 200, h: 200 })
    // Free: the south-east corner follows the pointer, clamped to the picture.
    expect(resizeRect({ x: 0, y: 0, w: 100, h: 100 }, 'se', 400, 30, source, null)).toEqual({ x: 0, y: 0, w: 400, h: 130 })
    // 16:9 from the north-west corner: the south-east corner stays put.
    const r = resizeRect({ x: 200, y: 100, w: 160, h: 90 }, 'nw', -160, 0, source, 16 / 9)
    expect(r.x + r.w).toBeCloseTo(360)
    expect(r.y + r.h).toBeCloseTo(190)
    expect(r.w / r.h).toBeCloseTo(16 / 9)
    expect(r.y).toBeGreaterThanOrEqual(0)
  })

  it('keeps the crop and focal point on the same part when turning', () => {
    const state = { orientation: NO_ORIENTATION, adjust: NO_ADJUSTMENTS, crop: { x: 0, y: 0, w: 200, h: 200 }, focal: { x: 50, y: 50 } }
    const turned = reorient(state, source, { rotate: turn(0, 90), flipH: false, flipV: false }, null)
    expect(turned.crop).toEqual({ x: 0, y: 0, w: 200, h: 200 })
    expect(turned.focal).toEqual({ x: 150, y: 50 })
    expect(turn(0, -90)).toBe(270)
    // A 16:9 box turned no longer fits the shape: fitted again.
    const wide = reorient({ ...state, crop: fitAspect(source, 16 / 9) }, source, { rotate: 90, flipH: false, flipV: false }, 16 / 9)
    expect(wide.crop.w / wide.crop.h).toBeCloseTo(16 / 9)
  })

  it('previews adjustments with CSS filters and picks a light preview file', () => {
    expect(filterCss(NO_ADJUSTMENTS)).toBeUndefined()
    expect(filterCss({ brightness: 50, contrast: -20, saturation: 0 })).toBe('brightness(1.5) contrast(0.8) saturate(1)')
    expect(focalPercent({ x: 150, y: 10 }, { x: 100, y: 0, w: 200, h: 200 })).toEqual({ x: 25, y: 5 })
    expect(focalPercent({ x: 0, y: 500 }, { x: 100, y: 0, w: 200, h: 200 })).toEqual({ x: 0, y: 100 })
    expect(previewUrl('/o.jpg', '/a-320.webp 320w, /a-1280.webp 1280w, /a-2560.webp 2560w')).toBe('/a-1280.webp')
    expect(previewUrl('/o.jpg', '/a-320.webp 320w, /o.jpg 800w')).toBe('/o.jpg')
  })
})
