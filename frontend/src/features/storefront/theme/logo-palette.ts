import { contrastRatio, AA_NORMAL } from '@/features/storefront/contrast'
import type { PaletteColors } from './theme-options'

/*
 * B21 "Get colours from my logo" (contract §6): the logo is drawn small on an offscreen canvas in
 * the browser, its pixels are grouped into a few colours (median cut, own code), see-through,
 * near-white and near-black pixels are left out, and two or three complete theme palettes are
 * proposed from what is left. Every text pair is then darkened or lightened until it passes WCAG
 * AA (4.5:1) — the same pairs the theme page checks (theme-form contrastPairs).
 */

export type Rgb = [number, number, number]
/** A colour of the logo and its share of the logo's coloured pixels (0–1). */
export type Swatch = { hex: string; share: number }

export type LogoProposal = { key: 'logo' | 'swapped' | 'calm'; name: string; description: string; colors: PaletteColors }

/* -------------------------------------------------------------------------------- colour math -- */

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

export function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')}`
}

function fromHex(hex: string): Rgb {
  const n = parseInt(hex.slice(1, 7), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

type Hsl = { h: number; s: number; l: number }

function toHsl([r, g, b]: Rgb): Hsl {
  const [rf, gf, bf] = [r / 255, g / 255, b / 255]
  const max = Math.max(rf, gf, bf)
  const min = Math.min(rf, gf, bf)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === rf ? (gf - bf) / d + (gf < bf ? 6 : 0) : max === gf ? (bf - rf) / d + 2 : (rf - gf) / d + 4
  return { h: h * 60, s, l }
}

function fromHsl({ h, s, l }: Hsl): Rgb {
  const hue = (((h % 360) + 360) % 360) / 360
  if (s === 0) return [l * 255, l * 255, l * 255]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (t: number) => {
    const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t
    if (x < 1 / 6) return p + (q - p) * 6 * x
    if (x < 1 / 2) return q
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
    return p
  }
  return [channel(hue + 1 / 3) * 255, channel(hue) * 255, channel(hue - 1 / 3) * 255]
}

const hsl = (hex: string) => toHsl(fromHex(hex))
const hexOf = (h: number, s: number, l: number) => toHex(fromHsl({ h, s: clamp01(s), l: clamp01(l) }))

const ratio = (a: string, b: string) => contrastRatio(a, b) ?? 1

/**
 * `foreground` moved in lightness (keeping its hue) until it reaches `min` contrast on every
 * background — darker on light backgrounds, lighter on dark ones; black or white as the last resort.
 */
export function ensureContrast(foreground: string, backgrounds: string[], min: number = AA_NORMAL): string {
  const passes = (hex: string) => backgrounds.every((bg) => ratio(hex, bg) >= min)
  if (passes(foreground)) return foreground
  const { h, s, l } = hsl(foreground)
  const darkBackgrounds = backgrounds.every((bg) => hsl(bg).l < 0.5)
  for (let step = 1; step <= 50; step += 1) {
    const candidate = hexOf(h, s, darkBackgrounds ? l + step * 0.02 : l - step * 0.02)
    if (passes(candidate)) return candidate
  }
  return darkBackgrounds ? '#ffffff' : '#000000'
}

/** Text for a coloured fill: white when it passes, else a very dark shade of the fill's hue, else the fill is darkened for white. */
function textOn(fill: string): { fill: string; text: string } {
  if (ratio('#ffffff', fill) >= AA_NORMAL) return { fill, text: '#ffffff' }
  const { h, s } = hsl(fill)
  const dark = hexOf(h, Math.min(s, 0.6), 0.09)
  if (ratio(dark, fill) >= AA_NORMAL) return { fill, text: dark }
  return { fill: ensureContrast(fill, ['#ffffff']), text: '#ffffff' }
}

/* ------------------------------------------------------------------------------ the swatches -- */

/** The pixels worth looking at: not see-through, not (near) white or black. */
function usablePixels(data: ArrayLike<number>): Rgb[] {
  const out: Rgb[] = []
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3]! < 128) continue
    const rgb: Rgb = [data[i]!, data[i + 1]!, data[i + 2]!]
    const max = Math.max(...rgb)
    const min = Math.min(...rgb)
    if (min > 235) continue // near-white (the logo's background)
    if (max < 30) continue // near-black
    out.push(rgb)
  }
  return out
}

/** Median cut: the box with the widest spread is split along that channel, until `count` boxes. */
function medianCut(pixels: Rgb[], count: number): Rgb[][] {
  const boxes: Rgb[][] = [pixels]
  const spread = (box: Rgb[]) => {
    let best = { channel: 0, range: -1 }
    for (const channel of [0, 1, 2]) {
      let lo = 255
      let hi = 0
      for (const p of box) {
        if (p[channel]! < lo) lo = p[channel]!
        if (p[channel]! > hi) hi = p[channel]!
      }
      if (hi - lo > best.range) best = { channel, range: hi - lo }
    }
    return best
  }
  while (boxes.length < count) {
    let pick = -1
    let score = 0
    for (const [index, box] of boxes.entries()) {
      const s = box.length > 1 ? spread(box).range * Math.sqrt(box.length) : 0
      if (s > score) {
        score = s
        pick = index
      }
    }
    if (pick < 0 || score < 8) break
    const box = boxes[pick]!
    const { channel } = spread(box)
    // Cut at the middle of the channel's range (keeps a logo's separate colours apart); the median
    // when that leaves one side empty.
    const values = box.map((p) => p[channel]!)
    const cut = (Math.min(...values) + Math.max(...values)) / 2
    let low = box.filter((p) => p[channel]! <= cut)
    let high = box.filter((p) => p[channel]! > cut)
    if (low.length === 0 || high.length === 0) {
      const sorted = [...box].sort((a, b) => a[channel]! - b[channel]!)
      const middle = Math.floor(sorted.length / 2)
      low = sorted.slice(0, middle)
      high = sorted.slice(middle)
    }
    boxes.splice(pick, 1, low, high)
  }
  return boxes.filter((box) => box.length > 0)
}

/** The logo's main colours from RGBA pixel data (most used first; similar colours merged). */
export function logoSwatches(data: ArrayLike<number>, max = 6): Swatch[] {
  const pixels = usablePixels(data)
  if (pixels.length === 0) return []
  const merged: { rgb: Rgb; count: number }[] = []
  for (const box of medianCut(pixels, 8)) {
    const sum = box.reduce<Rgb>((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0])
    const rgb: Rgb = [sum[0] / box.length, sum[1] / box.length, sum[2] / box.length]
    const near = merged.find((m) => Math.hypot(m.rgb[0] - rgb[0], m.rgb[1] - rgb[1], m.rgb[2] - rgb[2]) < 28)
    if (near) {
      const total = near.count + box.length
      near.rgb = [0, 1, 2].map((c) => (near.rgb[c]! * near.count + rgb[c]! * box.length) / total) as Rgb
      near.count = total
    } else {
      merged.push({ rgb, count: box.length })
    }
  }
  return merged
    .sort((a, b) => b.count - a.count)
    .slice(0, max)
    .map((m) => ({ hex: toHex(m.rgb), share: m.count / pixels.length }))
}

/* ------------------------------------------------------------------------------ the proposals -- */

const hueDistance = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/** Everything else follows from a primary and an accent (with the canvas tinted or plain). */
function paletteFrom(primary: string, accent: string, tinted: boolean): PaletteColors {
  const { h, s } = hsl(primary)
  const brand = textOn(primary)
  const second = textOn(accent)
  const canvas = tinted && s > 0.05 ? hexOf(h, Math.min(s, 0.5), 0.975) : '#fafafa'
  const surface = '#ffffff'
  const border = tinted && s > 0.05 ? hexOf(h, Math.min(s, 0.35), 0.89) : '#e4e4e7'
  const heading = ensureContrast(s > 0.05 ? hexOf(h, Math.min(s, 0.45), 0.14) : '#18181b', [surface, canvas])
  const text = ensureContrast(s > 0.05 ? hexOf(h, 0.12, 0.33) : '#52525b', [surface, canvas])
  const link = ensureContrast(second.fill, [canvas, surface])
  return {
    primary: brand.fill,
    primary_foreground: brand.text,
    accent: second.fill,
    accent_foreground: second.text,
    highlight: '#15803d',
    sale: '#b91c1c',
    heading,
    text,
    canvas,
    surface,
    border,
    button: brand.fill,
    button_foreground: brand.text,
    link,
  }
}

/**
 * Two or three palettes from the logo's swatches: its own colours (main colour on the buttons), the
 * two swapped (when the logo has a second colour), and a calm one (plain background, deeper
 * buttons). Empty when the logo has no colour worth using (all white, black or see-through).
 */
export function proposeFromLogo(swatches: Swatch[]): LogoProposal[] {
  if (swatches.length === 0) return []
  const info = swatches.map((sw) => ({ ...sw, ...hsl(sw.hex) }))
  const colourful = info
    .filter((c) => c.s >= 0.18 && c.l >= 0.12 && c.l <= 0.9)
    .sort((a, b) => b.share * (0.5 + b.s) - a.share * (0.5 + a.s))
  const main = colourful[0] ?? [...info].sort((a, b) => a.l - b.l)[0]!
  const other = colourful.find((c) => c !== main && hueDistance(c.h, main.h) >= 25) ?? null
  const accent = other?.hex ?? hexOf(main.h, Math.min(main.s, 0.6), Math.max(0.18, main.l - 0.25))

  const proposals: LogoProposal[] = [
    { key: 'logo', name: 'Your logo’s colours', description: 'Buttons in your logo’s main colour, a light tint behind the page.', colors: paletteFrom(main.hex, accent, true) },
  ]
  if (other) proposals.push({ key: 'swapped', name: 'Swapped', description: 'Your logo’s second colour on the buttons.', colors: paletteFrom(other.hex, main.hex, true) })
  const deep = main.l > 0.45 ? hexOf(main.h, main.s, 0.38) : main.hex
  proposals.push({ key: 'calm', name: 'Calm', description: 'A plain white page with deeper buttons — lets your products stand out.', colors: paletteFrom(deep, hexOf(main.h, Math.min(main.s, 0.2), 0.25), false) })

  const seen = new Set<string>()
  return proposals.filter((p) => {
    const key = JSON.stringify(p.colors)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/* ----------------------------------------------------------------------------- reading a logo -- */

/** The logo's RGBA pixels, drawn at most `size` px wide on an offscreen canvas. */
export async function readLogoPixels(url: string, size = 64): Promise<Uint8ClampedArray> {
  const img = new Image()
  img.decoding = 'async'
  // Media is served from this origin; anything else is asked for with CORS (or the canvas can't be read).
  if (new URL(url, window.location.href).origin !== window.location.origin) img.crossOrigin = 'anonymous'
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('The logo couldn’t be loaded.'))
    img.src = url
  })
  const scale = Math.min(1, size / Math.max(img.naturalWidth || size, img.naturalHeight || size))
  const width = Math.max(1, Math.round((img.naturalWidth || size) * scale))
  const height = Math.max(1, Math.round((img.naturalHeight || size) * scale))
  const canvas: OffscreenCanvas | HTMLCanvasElement =
    typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height })
  const context = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  if (!context) throw new Error('This browser can’t read pictures.')
  context.drawImage(img, 0, 0, width, height)
  return context.getImageData(0, 0, width, height).data
}
