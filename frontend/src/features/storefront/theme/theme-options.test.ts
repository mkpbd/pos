import { describe, expect, it } from 'vitest'
import { contrastRatio } from '@/features/storefront/contrast'
import { colorValues } from '@/features/storefront/theme-form'
import { applyPalette, paletteMatches, PREDEFINED_PALETTES, withColor } from './theme-options'

const today = colorValues({ primary: '#f59e0b', primary_foreground: '#3b2500', accent: '#6f55c2', accent_foreground: '#ffffff', highlight: '#2fb79a', sale: '#c2410c', heading: '#3d3d3d', text: '#5f6368', canvas: '#f3f7fa', surface: '#ffffff', border: '#e1e1e1', button: '#f59e0b', button_foreground: '#3b2500', link: '#6f55c2', button_hover: null })

describe('predefined palettes', () => {
  it('offers eight distinct palettes with every colour role', () => {
    expect(PREDEFINED_PALETTES).toHaveLength(8)
    expect(new Set(PREDEFINED_PALETTES.map((p) => p.key)).size).toBe(8)
    for (const p of PREDEFINED_PALETTES) {
      for (const value of Object.values(p.colors)) expect(value).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it.each(PREDEFINED_PALETTES.map((p) => [p.name, p] as const))('%s passes WCAG AA (4.5:1) for its text pairs', (_name, p) => {
    const c = p.colors
    const pairs: [string, string, string][] = [
      ['text on primary', c.primary_foreground, c.primary],
      ['text on secondary', c.accent_foreground, c.accent],
      ['button text', c.button_foreground, c.button],
      ['body text on surface', c.text, c.surface],
      ['body text on background', c.text, c.canvas],
      ['headings on background', c.heading, c.canvas],
      ['headings on surface', c.heading, c.surface],
      ['links on background', c.link, c.canvas],
      ['links on surface', c.link, c.surface],
      ['secondary text on surface', c.accent, c.surface],
      ['white on sale badges', '#ffffff', c.sale],
      ['sale text on surface', c.sale, c.surface],
      ['white on new badges', '#ffffff', c.highlight],
      ['highlight text on surface', c.highlight, c.surface],
    ]
    for (const [label, fg, bg] of pairs) expect([label, (contrastRatio(fg, bg) ?? 0) >= 4.5]).toEqual([label, true])
  })

  it('applying one sets every role and makes the hover automatic again', () => {
    const forest = PREDEFINED_PALETTES.find((p) => p.key === 'forest')!
    const next = applyPalette({ ...today, button_hover: '#000000' }, forest)
    expect(next).toEqual({ ...forest.colors, button_hover: null })
    expect(paletteMatches(next, forest)).toBe(true)
    expect(paletteMatches(today, forest)).toBe(false)
  })
})

describe('withColor', () => {
  it('moves the buttons and links along while they still match their source colour', () => {
    const next = withColor(today, 'primary', '#1d4ed8')
    expect(next).toMatchObject({ primary: '#1d4ed8', button: '#1d4ed8' })
    expect(withColor(today, 'accent', '#0f766e')).toMatchObject({ accent: '#0f766e', link: '#0f766e' })
    expect(withColor(today, 'primary_foreground', '#ffffff')).toMatchObject({ button_foreground: '#ffffff' })
  })

  it('keeps a role the owner set on its own', () => {
    const custom = { ...today, button: '#111111' }
    expect(withColor(custom, 'primary', '#1d4ed8')).toMatchObject({ primary: '#1d4ed8', button: '#111111' })
    expect(withColor(today, 'button', null).button).toBeNull()
  })
})
