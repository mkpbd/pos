import { bootstrapFixture } from './test-fixtures'
import { bodyPreloadUrl, themeFontLoads } from './font-loader'
import { banglaStacks, customFontFaceCss, effectiveBanglaFonts, fontStack, toCustomFonts, usedFonts, BANGLA_FONTS, FONT_INFO } from './fonts'
import { mergeThemeSettings } from './builder/canvas/theme-override'
import { themeToCssVars } from './theme'
import type { StorefrontTheme } from './types'

const UUID = '0193ab12-cd34-7000-8000-00000000f001'
const custom = { id: `custom:${UUID}`, name: 'Shonar', family: 'sf-custom-0193ab12cd34', url: `/storage/fonts/o/${UUID}.woff2`, format: 'woff2', weight_min: 400, weight_max: 700 } as const

function themeWith(typography: Partial<StorefrontTheme['typography']>, fonts?: StorefrontTheme['fonts']): StorefrontTheme {
  const theme = bootstrapFixture().theme
  return { ...theme, typography: { ...theme.typography, ...typography }, fonts }
}

describe('B10 theme fonts', () => {
  it('has a stack for every built-in font; Bangla fonts draw Bengali', () => {
    for (const key of BANGLA_FONTS) {
      expect(FONT_INFO[key].bengali).toBe(true)
      expect(fontStack(key)).toContain(FONT_INFO[key].family!)
    }
    expect(fontStack('tiro-bangla')).toContain('Georgia')
    expect(fontStack('comic-sans')).toContain('system-ui')
    // Uploaded fonts: from the theme payload or the fonts API record; unknown ones fall back.
    expect(fontStack(custom.id, [custom])).toMatch(/^'sf-custom-0193ab12cd34', system-ui/)
    expect(fontStack(custom.id, [{ id: UUID, key: custom.id, family: custom.family, url: custom.url }])).toMatch(/^'sf-custom-0193ab12cd34'/)
    expect(fontStack(custom.id, [])).toContain('system-ui')
  })

  it('writes @font-face rules for uploaded fonts only with a safe family and URL', () => {
    expect(customFontFaceCss([custom])).toBe(
      `@font-face{font-family:'sf-custom-0193ab12cd34';src:url("/storage/fonts/o/${UUID}.woff2") format('woff2');font-weight:400 700;font-style:normal;font-display:swap}`,
    )
    expect(customFontFaceCss([{ ...custom, url: 'javascript:alert(1)' }])).toBe('')
    expect(customFontFaceCss([{ ...custom, url: '/x.woff2") ;}body{x' }])).toBe('')
    expect(customFontFaceCss([{ ...custom, family: "x'}body{" }])).toBe('')
    expect(toCustomFonts([custom, custom, { id: 'nope' }])).toHaveLength(1)
  })

  it('resolves the Bangla fonts like the server: chosen, else a Bangla main font, else today’s', () => {
    expect(effectiveBanglaFonts({ heading_font: 'baloo', body_font: 'poppins' }, [])).toEqual({ heading: 'baloo-da-2', body: 'hind-siliguri' })
    expect(effectiveBanglaFonts({ heading_font: 'anek-bangla', body_font: 'noto-sans-bengali' }, [])).toEqual({ heading: 'anek-bangla', body: 'noto-sans-bengali' })
    expect(effectiveBanglaFonts({ heading_font: 'baloo', body_font: 'poppins', bangla_heading_font: 'tiro-bangla', bangla_body_font: custom.id }, [custom])).toEqual({ heading: 'tiro-bangla', body: custom.id })
    // A deleted uploaded font falls back.
    expect(effectiveBanglaFonts({ heading_font: 'baloo', body_font: 'poppins', bangla_body_font: custom.id }, [])).toMatchObject({ body: 'hind-siliguri' })
  })

  it('a theme from before B10 keeps today’s fonts and spacing for Bangla', () => {
    const theme = themeWith({})
    expect(banglaStacks(theme)).toEqual({ body: "'Hind Siliguri', var(--sf-font-body)", heading: "'Baloo Da 2 Variable', var(--sf-font-heading)" })
    const vars = themeToCssVars(theme)
    expect(vars['--sf-font-bangla-body']).toBe("'Hind Siliguri', var(--sf-font-body)")
    expect(vars['--sf-bangla-line-height']).toBeUndefined()
    expect(vars['--sf-bangla-scale']).toBeUndefined()
    // Hind Siliguri for Bangla only loads its Bengali subsets (Latin keeps Poppins).
    expect(themeFontLoads(theme)).toEqual([
      { key: 'baloo', main: true },
      { key: 'baloo-da-2', main: false },
      { key: 'hind-siliguri', main: false },
      { key: 'poppins', main: true },
    ])
  })

  it('applies the theme’s Bangla fonts, line height and scale', () => {
    const theme = themeWith({ heading_font: 'playfair', body_font: 'noto-sans-bengali', bangla_heading_font: 'anek-bangla', bangla_line_height: 1.8, bangla_scale: 1.1 })
    const vars = themeToCssVars(theme)
    expect(vars['--sf-font-body']).toMatch(/^'Noto Sans Bengali Variable'/)
    // The body font draws Bengali itself: nothing in front of it.
    expect(vars['--sf-font-bangla-body']).toBe('var(--sf-font-body)')
    expect(vars['--sf-font-bangla-heading']).toBe("'Anek Bangla Variable', var(--sf-font-heading)")
    expect(vars['--sf-bangla-line-height']).toBe('1.8')
    expect(vars['--sf-bangla-leading-factor']).toBe('1.2')
    expect(vars['--sf-bangla-scale']).toBe('1.1')
    expect(themeToCssVars(themeWith({ bangla_line_height: 9, bangla_scale: 0 }))['--sf-bangla-line-height']).toBe('2')
    // Only the fonts in use load; no Poppins, no Baloo.
    expect(usedFonts(theme).builtIn.map((f) => f.key)).toEqual(['anek-bangla', 'noto-sans-bengali', 'playfair'])
    expect(bodyPreloadUrl(theme, 'bn')).toMatch(/noto-sans-bengali-bengali/)
    expect(bodyPreloadUrl(theme, 'en')).toMatch(/noto-sans-bengali-latin/)
    expect(bodyPreloadUrl(themeWith({ body_font: 'system' }), 'en')).toBeNull()
  })

  it('uploaded fonts: their family in the stacks and their rules from the theme payload', () => {
    const theme = themeWith({ heading_font: custom.id }, { heading: custom.id, body: 'poppins', bangla_heading: 'baloo-da-2', bangla_body: 'hind-siliguri', custom: [custom] })
    expect(themeToCssVars(theme)['--sf-font-heading']).toMatch(/^'sf-custom-0193ab12cd34'/)
    expect(usedFonts(theme).custom).toEqual([expect.objectContaining({ id: custom.id, family: custom.family })])
  })

  it('the canvas resolves a Site styles draft that picks an uploaded font from the editor’s list', () => {
    const theme = themeWith({})
    const merged = mergeThemeSettings(theme, { typography: { body_font: custom.id, bangla_body_font: null } }, [{ id: UUID, key: custom.id, name: 'Shonar', family: custom.family, url: custom.url, weight_min: 400, weight_max: 700 }])
    expect(merged.fonts).toMatchObject({ body: custom.id, bangla_body: 'hind-siliguri', custom: [expect.objectContaining({ id: custom.id })] })
    expect(themeToCssVars(merged)['--sf-font-body']).toMatch(/^'sf-custom-0193ab12cd34'/)
  })

  it('storefront.css imports no font; Bangla rules read the theme variables', async () => {
    // A runtime specifier keeps Node types out of the app build (as in theme.test.ts).
    const fsModule = 'node:fs'
    const { readFileSync } = (await import(/* @vite-ignore */ fsModule)) as { readFileSync(path: string, encoding: 'utf8'): string }
    const css = readFileSync(`${(globalThis as unknown as { process: { cwd(): string } }).process.cwd()}/src/storefront/storefront.css`, 'utf8')
    expect(css).not.toMatch(/@import "@fontsource/)
    expect(css).toContain('font-family: var(--sf-font-bangla-body)')
    expect(css).toContain('--sf-lang-scale: var(--sf-bangla-scale)')
  })
})
