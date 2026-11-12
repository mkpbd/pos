import { normalizeGradient, normalizeShadow } from '@/storefront/builder/validate'
import { contrast, describeColor, inkOn, parseColor, resolveColor, toHex, toRgbString } from './color-utils'
import {
  addStop,
  BOX_SHADOW_PRESETS,
  buildLength,
  cornersLinked,
  DEFAULT_GRADIENT,
  gradientPreviewCss,
  MAX_STOPS,
  removeStop,
  setCorner,
  setSide,
  shadowPreset,
  sidesLinked,
  splitLength,
  switchBackgroundType,
  TEXT_SHADOW_PRESETS,
} from './model'

describe('colour maths', () => {
  it('parses hex (3, 4, 6, 8 digits) and rgb()/rgba() and refuses anything else', () => {
    expect(parseColor('#1D4ED8')).toEqual({ r: 29, g: 78, b: 216, a: 1 })
    expect(parseColor('1d4ed8')).toEqual({ r: 29, g: 78, b: 216, a: 1 })
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 })
    expect(parseColor('#00000080')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 })
    expect(parseColor('rgb(29, 78, 216)')).toEqual({ r: 29, g: 78, b: 216, a: 1 })
    expect(parseColor('rgba(29 78 216 / 50%)')).toEqual({ r: 29, g: 78, b: 216, a: 0.5 })
    expect(parseColor('rgba(0, 0, 0, 0.25)')).toEqual({ r: 0, g: 0, b: 0, a: 0.25 })
    for (const bad of ['', 'red', '#12345', 'rgb(300, 0, 0)', 'rgba(0,0,0,2)', 'url(x)', 'theme:primary']) expect(parseColor(bad)).toBeNull()
  })

  it('writes #rrggbb, or #rrggbbaa only for see-through colours where alpha is allowed', () => {
    expect(toHex({ r: 29, g: 78, b: 216, a: 1 })).toBe('#1d4ed8')
    expect(toHex({ r: 29, g: 78, b: 216, a: 0.5 })).toBe('#1d4ed880')
    expect(toHex({ r: 29, g: 78, b: 216, a: 0.5 }, false)).toBe('#1d4ed8')
    expect(toRgbString({ r: 1, g: 2, b: 3, a: 0.5 })).toBe('rgba(1, 2, 3, 0.5)')
    expect(toRgbString({ r: 1, g: 2, b: 3, a: 1 })).toBe('rgb(1, 2, 3)')
  })

  it('resolves theme tokens with the theme colours and describes values in plain words', () => {
    expect(resolveColor('theme:primary', { primary: '#F59E0B' })).toBe('#f59e0b')
    expect(resolveColor('theme:primary')).toBeNull()
    expect(describeColor('theme:accent')).toBe('Secondary (theme)')
    expect(describeColor('#1d4ed880')).toBe('#1d4ed8 · 50 %')
    expect(describeColor(null, 'Default')).toBe('Default')
  })

  it('computes WCAG contrast (see-through text over its background)', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 0)
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
    expect(contrast('#00000000', '#ffffff')).toBeCloseTo(1, 5)
    expect(contrast('x', '#fff')).toBeNull()
    expect(inkOn('#ffffff')).toBe('#000000')
    expect(inkOn('#111827')).toBe('#ffffff')
  })
})

describe('lengths', () => {
  it('builds valid lengths per field rules and explains the rest', () => {
    expect(buildLength('24', 'px')).toEqual({ value: '24px' })
    expect(buildLength('1.257', 'rem')).toEqual({ value: '1.26rem' })
    expect(buildLength('', 'px')).toEqual({ value: undefined })
    expect(buildLength('-8', 'px')).toEqual({ error: 'Use zero or more.' })
    expect(buildLength('-8', 'px', { allowNegative: true })).toEqual({ value: '-8px' })
    expect(buildLength('101', '%')).toHaveProperty('error')
    expect(buildLength('2001', 'px')).toHaveProperty('error')
    expect(buildLength('25', 'px', { max: 20 })).toHaveProperty('error')
    expect(buildLength('10', 'vh', { units: ['px'] })).toHaveProperty('error')
    expect(buildLength('abc', 'px')).toEqual({ error: 'Enter a number.' })
    expect(buildLength('', 'auto', { allowAuto: true })).toEqual({ value: 'auto' })
    expect(buildLength('', 'auto')).toHaveProperty('error')
  })

  it('splits stored lengths', () => {
    expect(splitLength('-1.5em')).toEqual({ amount: '-1.5', unit: 'em' })
    expect(splitLength('auto')).toEqual({ amount: '', unit: 'auto' })
    expect(splitLength('12')).toBeNull()
  })
})

describe('gradients', () => {
  it('adds stops in the widest gap up to five and removes down to two, always valid', () => {
    let g = DEFAULT_GRADIENT
    g = addStop(g)
    expect(g.stops.map((s) => s.position)).toEqual([0, 50, 100])
    expect(normalizeGradient(g)).toEqual(g)
    g = addStop(addStop(g))
    expect(g.stops).toHaveLength(MAX_STOPS)
    expect(addStop(g)).toBe(g)
    let r = removeStop(g, 1)
    expect(r.stops).toHaveLength(4)
    r = removeStop(removeStop(r, 0), 0)
    expect(r.stops).toHaveLength(2)
    expect(removeStop(r, 0)).toBe(r)
  })

  it('previews with theme colours resolved', () => {
    expect(gradientPreviewCss({ type: 'linear', angle: 90, stops: [{ color: 'theme:primary', position: 0 }, { color: '#000000', position: 100 }] }, { primary: '#ff0000' })).toBe('linear-gradient(90deg, #ff0000 0%, #000000 100%)')
    expect(gradientPreviewCss({ type: 'radial', shape: 'circle', stops: [{ color: '#ffffff', position: 0 }, { color: '#000000', position: 100 }] })).toBe('radial-gradient(circle, #ffffff 0%, #000000 100%)')
  })
})

describe('shadows, sides, corners, backgrounds', () => {
  it('recognises presets; every preset is a valid shadow', () => {
    expect(shadowPreset(undefined)).toBeUndefined()
    expect(shadowPreset([])).toBe('none')
    expect(shadowPreset(BOX_SHADOW_PRESETS.medium)).toBe('medium')
    expect(shadowPreset(TEXT_SHADOW_PRESETS.strong, true)).toBe('strong')
    expect(shadowPreset([{ x: 1, y: 1, blur: 1, spread: 0, color: '#000000', inset: false }])).toBe('custom')
    for (const list of [...Object.values(BOX_SHADOW_PRESETS), ...Object.values(TEXT_SHADOW_PRESETS)]) for (const s of list) expect(normalizeShadow(s)).toEqual(s)
  })

  it('sets linked or single sides and corners, dropping empty ones', () => {
    expect(setSide(undefined, 'all', '8px')).toEqual({ top: '8px', right: '8px', bottom: '8px', left: '8px' })
    expect(setSide({ top: '8px', right: '8px' }, 'top', undefined)).toEqual({ right: '8px' })
    expect(setSide({ top: '8px' }, 'top', undefined)).toBeUndefined()
    expect(sidesLinked({ top: '1px', right: '1px', bottom: '1px', left: '1px' })).toBe(true)
    expect(sidesLinked({ top: '1px' })).toBe(false)
    expect(sidesLinked(undefined)).toBe(true)
    expect(setCorner(undefined, 'all', '12px')).toEqual({ tl: '12px', tr: '12px', br: '12px', bl: '12px' })
    expect(setCorner({ tl: '1px' }, 'tl', undefined)).toBeUndefined()
    expect(cornersLinked({ tl: '1px', tr: '2px', br: '1px', bl: '1px' })).toBe(false)
  })

  it('switches background types keeping what was set', () => {
    expect(switchBackgroundType(undefined, 'none')).toEqual({ type: 'none' })
    expect(switchBackgroundType(undefined, 'color')).toEqual({ type: 'color', color: 'theme:surface' })
    const image = { type: 'image' as const, image: { media_id: 'x', position: 'center' as const, size: 'cover' as const, repeat: false }, overlay: '#00000066' }
    expect(switchBackgroundType(image, 'gradient')).toEqual({ type: 'gradient', gradient: DEFAULT_GRADIENT, overlay: '#00000066' })
    expect(switchBackgroundType({ type: 'gradient', gradient: DEFAULT_GRADIENT }, 'image')).toEqual({ type: 'image' })
  })
})
