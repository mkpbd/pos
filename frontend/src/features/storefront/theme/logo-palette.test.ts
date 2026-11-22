import { contrastRatio, meetsAA } from '@/features/storefront/contrast'
import { colorValues, contrastPairs } from '@/features/storefront/theme-form'
import { ensureContrast, logoSwatches, proposeFromLogo, toHex } from './logo-palette'

/* B21 "Get colours from my logo": the swatches, the proposals, and every text pair passing WCAG AA. */

type Px = [number, number, number, number]

/** RGBA pixel data: `count` pixels of each colour. */
function pixels(...parts: [Px, number][]): Uint8ClampedArray {
  const out: number[] = []
  for (const [px, count] of parts) for (let i = 0; i < count; i += 1) out.push(...px)
  return new Uint8ClampedArray(out)
}

const ORANGE: Px = [234, 88, 12, 255]
const NAVY: Px = [30, 58, 138, 255]
const WHITE: Px = [255, 255, 255, 255]
const BLACK: Px = [5, 5, 5, 255]
const CLEAR: Px = [200, 0, 0, 0]

const hue = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max === min) return 0
  const d = max - min
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return h * 60
}

const allPass = (colors: Parameters<typeof colorValues>[0]) => contrastPairs({ colors: colorValues(colors) }).every((p) => meetsAA(contrastRatio(p.foreground, p.background)))

describe('B21 logo swatches', () => {
  it('leaves out see-through, near-white and near-black pixels; most used first', () => {
    const swatches = logoSwatches(pixels([WHITE, 500], [CLEAR, 300], [BLACK, 100], [ORANGE, 600], [NAVY, 300]))
    expect(swatches.map((s) => s.hex)).toEqual(['#ea580c', '#1e3a8a'])
    expect(swatches[0]!.share).toBeCloseTo(600 / 900)
    expect(logoSwatches(pixels([WHITE, 10], [BLACK, 10], [CLEAR, 10]))).toEqual([])
  })

  it('merges near shades (anti-aliased edges) into one colour', () => {
    const swatches = logoSwatches(pixels([ORANGE, 400], [[230, 92, 18, 255], 50], [NAVY, 200]))
    expect(swatches).toHaveLength(2)
    expect(toHex([255, 0, 128])).toBe('#ff0080')
  })
})

describe('B21 palettes from a logo', () => {
  it('two colours: the logo’s, swapped and calm — each passing every AA pair', () => {
    const proposals = proposeFromLogo(logoSwatches(pixels([ORANGE, 600], [NAVY, 300], [WHITE, 400])))
    expect(proposals.map((p) => p.key)).toEqual(['logo', 'swapped', 'calm'])
    for (const p of proposals) expect(allPass(p.colors)).toBe(true)
    const [logo, swapped, calm] = proposals as [(typeof proposals)[0], (typeof proposals)[0], (typeof proposals)[0]]
    // Orange keeps its colour on the buttons with dark text (white on it would fail).
    expect(logo.colors.primary).toBe('#ea580c')
    expect(contrastRatio('#ffffff', '#ea580c')!).toBeLessThan(4.5)
    expect(contrastRatio(logo.colors.primary_foreground, logo.colors.primary)!).toBeGreaterThanOrEqual(4.5)
    expect(logo.colors.button).toBe(logo.colors.primary)
    expect(swapped.colors.primary).toBe('#1e3a8a')
    expect(swapped.colors.primary_foreground).toBe('#ffffff')
    expect(calm.colors.canvas).toBe('#fafafa')
    // The page background is a light tint of the logo's colour.
    expect(Math.abs(hue(logo.colors.canvas) - hue('#ea580c'))).toBeLessThan(12)
  })

  it('one colour: no swapped palette; a pale or bright colour gets readable text', () => {
    const yellow = proposeFromLogo(logoSwatches(pixels([[250, 204, 21, 255], 500], [WHITE, 200])))
    expect(yellow.map((p) => p.key)).toEqual(['logo', 'calm'])
    for (const p of yellow) expect(allPass(p.colors)).toBe(true)
    expect(yellow[0]!.colors.primary).toBe('#facc15')
  })

  it('a grey logo still gets palettes; an only-black-and-white logo gets none', () => {
    const grey = proposeFromLogo(logoSwatches(pixels([[120, 120, 120, 255], 300])))
    expect(grey.length).toBeGreaterThan(0)
    for (const p of grey) expect(allPass(p.colors)).toBe(true)
    expect(proposeFromLogo([])).toEqual([])
  })

  it('ensureContrast darkens on light backgrounds and lightens on dark ones', () => {
    const dark = ensureContrast('#9ca3af', ['#ffffff'])
    expect(contrastRatio(dark, '#ffffff')!).toBeGreaterThanOrEqual(4.5)
    const light = ensureContrast('#334155', ['#0f172a'])
    expect(contrastRatio(light, '#0f172a')!).toBeGreaterThanOrEqual(4.5)
    expect(ensureContrast('#111111', ['#ffffff'])).toBe('#111111')
  })
})
