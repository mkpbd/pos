import { describe, expect, it, vi } from 'vitest'
import { fetchBootstrap, isDraftPreviewUrl, readInlineBootstrap } from './api'
import { bootstrapFixture } from './test-fixtures'
import { applyCssVars, applyDataAttributes, DEFAULT_LAYOUT, isInternalLink, resolveLayout, themeDataAttributes, themeToCssVars } from './theme'
import { headingStepPx, resolveTypeScale, TYPE_DEFAULTS, typeSamples } from './type-scale'

describe('themeToCssVars', () => {
  it('maps colours, fonts, radii and container width to --sf-* variables', () => {
    const theme = bootstrapFixture().theme
    const vars = themeToCssVars(theme)

    expect(vars['--sf-primary']).toBe('#f59e0b')
    expect(vars['--sf-primary-foreground']).toBe('#3b2500')
    expect(vars['--sf-accent-foreground']).toBe('#ffffff')
    expect(vars['--sf-font-heading']).toMatch(/^'Baloo 2 Variable'/)
    expect(vars['--sf-font-body']).toMatch(/^'Poppins'/)
    expect(vars['--sf-radius-button']).toBe('9999px')
    expect(vars['--sf-radius-card']).toBe('12px')
    expect(vars['--sf-container']).toBe('1170px')
  })

  it('supports every button style and the system font choices', () => {
    const base = bootstrapFixture().theme
    const square = themeToCssVars({ ...base, shape: { button_style: 'square', card_radius: 0 }, typography: { heading_font: 'system', body_font: 'system' } })

    expect(square['--sf-radius-button']).toBe('0px')
    expect(square['--sf-radius-card']).toBe('0px')
    expect(square['--sf-font-heading']).toMatch(/^system-ui/)
    expect(square['--sf-font-body']).toMatch(/^system-ui/)
    expect(themeToCssVars({ ...base, shape: { button_style: 'rounded', card_radius: 8 } })['--sf-radius-button']).toBe('0.5rem')
  })

  it('maps the preset fonts and the heading case (today’s look: no transform)', () => {
    const base = bootstrapFixture().theme
    expect(themeToCssVars(base)['--sf-heading-transform']).toBe('none')
    expect(themeToCssVars(base)['--sf-heading-tracking']).toBe('normal')

    const handmade = themeToCssVars({ ...base, typography: { heading_font: 'playfair', body_font: 'jost' }, layout: { ...base.layout, heading_case: 'lowercase' } })
    expect(handmade['--sf-font-heading']).toMatch(/^'Playfair Display Variable', Georgia/)
    expect(handmade['--sf-font-body']).toMatch(/^'Jost Variable'/)
    expect(handmade['--sf-heading-transform']).toBe('lowercase')

    const classic = themeToCssVars({ ...base, typography: { heading_font: 'jost', body_font: 'jost' }, layout: { ...base.layout, heading_case: 'uppercase' } })
    expect(classic['--sf-font-heading']).toMatch(/^'Jost Variable'/)
    expect(classic['--sf-heading-transform']).toBe('uppercase')
    expect(classic['--sf-heading-tracking']).toBe('0.04em')
  })

  it('picks a star colour that stands out on the dark footer (the heading colour)', () => {
    const base = bootstrapFixture().theme
    // Today's amber stands out on #3d3d3d: kept.
    expect(themeToCssVars(base)['--sf-star-on-dark']).toBe('#f59e0b')
    // Classic: a #111 primary on a #111 footer would vanish — the surface colour instead.
    const classic = { ...base.colors, primary: '#111111', heading: '#111111', surface: '#ffffff' }
    expect(themeToCssVars({ ...base, colors: classic })['--sf-star-on-dark']).toBe('#ffffff')
  })

  it('applies variables to an element and removes them again', () => {
    const element = document.createElement('div')
    const remove = applyCssVars(element, { '--sf-primary': '#123456' })
    expect(element.style.getPropertyValue('--sf-primary')).toBe('#123456')
    remove()
    expect(element.style.getPropertyValue('--sf-primary')).toBe('')
  })
})

describe('layout variants', () => {
  it('fills missing and unknown variants with today’s look', () => {
    expect(resolveLayout({ container_width: 1170, sticky_header: true })).toEqual(DEFAULT_LAYOUT)
    expect(DEFAULT_LAYOUT).toEqual({ header_style: 'standard', footer_style: 'columns', card_style: 'standard', hero_style: 'full', heading_case: 'normal', top_bar: 'none' })
    expect(resolveLayout({ container_width: 1170, sticky_header: true, header_style: 'floating' as never, card_style: 'minimal' })).toEqual({ ...DEFAULT_LAYOUT, card_style: 'minimal' })
  })

  it('exposes the preset and variants as data attributes', () => {
    const base = bootstrapFixture().theme
    const attributes = themeDataAttributes({ ...base, preset: 'vegan', layout: { ...base.layout, top_bar: 'ticker' } })
    expect(attributes).toMatchObject({ 'data-sf-preset': 'vegan', 'data-sf-top-bar': 'ticker', 'data-sf-header': 'standard' })
    expect(themeDataAttributes(base)['data-sf-preset']).toBe('default')

    const element = document.createElement('div')
    const remove = applyDataAttributes(element, attributes)
    expect(element).toHaveAttribute('data-sf-top-bar', 'ticker')
    remove()
    expect(element).not.toHaveAttribute('data-sf-top-bar')
  })
})

describe('isInternalLink', () => {
  it('treats site paths as internal and everything else as external', () => {
    expect(isInternalLink('/boys')).toBe(true)
    expect(isInternalLink('//evil.test')).toBe(false)
    expect(isInternalLink('https://blog.example.com')).toBe(false)
  })
})

describe('readInlineBootstrap', () => {
  it('reads the payload written into the page by the server', () => {
    const doc = document.implementation.createHTMLDocument()
    const script = doc.createElement('script')
    script.id = 'storefront-bootstrap'
    script.type = 'application/json'
    script.textContent = JSON.stringify(bootstrapFixture())
    doc.body.appendChild(script)

    expect(readInlineBootstrap(doc)?.store.name).toBe('Berry Kids')
  })

  it('returns nothing when the payload is absent or broken', () => {
    const doc = document.implementation.createHTMLDocument()
    expect(readInlineBootstrap(doc)).toBeUndefined()

    const script = doc.createElement('script')
    script.id = 'storefront-bootstrap'
    script.textContent = '{not json'
    doc.body.appendChild(script)
    expect(readInlineBootstrap(doc)).toBeUndefined()
  })
})

describe('B3 colour roles and type scale', () => {
  // The defaults storefront.css paints before the theme arrives (and that Tailwind used until B3).
  // Read from disk: vitest stubs CSS imports (even `?raw`). A runtime specifier keeps Node types out of the app build.
  const rootVars = async (): Promise<Record<string, string>> => {
    const fsModule = 'node:fs'
    const { readFileSync } = (await import(/* @vite-ignore */ fsModule)) as { readFileSync(path: string, encoding: 'utf8'): string }
    const css = readFileSync(`${(globalThis as unknown as { process: { cwd(): string } }).process.cwd()}/src/storefront/storefront.css`, 'utf8')
    const root = /:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    return Object.fromEntries([...root.matchAll(/(--sf-[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2]!.trim()]))
  }

  it('a theme from before B3 produces today’s values: Tailwind’s sizes, the primary buttons and accent links', () => {
    const vars = themeToCssVars(bootstrapFixture().theme)
    expect(vars).toMatchObject({
      '--sf-text-xs': '0.75rem',
      '--sf-text-sm': '0.875rem',
      '--sf-text-base': '1rem',
      '--sf-text-lg': '1.125rem',
      '--sf-text-xl': '1.25rem',
      '--sf-text-2xl': '1.5rem',
      '--sf-text-3xl': '1.875rem',
      '--sf-text-4xl': '2.25rem',
      '--sf-text-5xl': '3rem',
      '--sf-text-6xl': '3.75rem',
      '--sf-text-7xl': '4.5rem',
      '--sf-rich-h2': '1.75rem',
      '--sf-rich-h3': '1.375rem',
      '--sf-rich-h4': '1.125rem',
      '--sf-line-height': '1.5',
      '--sf-leading-factor': '1',
      '--sf-mobile-scale': '1',
      '--sf-heading-weight-shift': '0',
      '--sf-heading-tracking': 'normal',
      '--sf-button': '#f59e0b',
      '--sf-button-foreground': '#3b2500',
      '--sf-button-hover': '#f59e0b',
      '--sf-link': '#6f55c2',
    })
    // Headings keep inheriting their letter spacing; no null colour becomes a variable.
    expect(vars).not.toHaveProperty('--sf-heading-letter-spacing')
    expect(Object.values(vars).some((v) => v === 'null' || v === 'undefined')).toBe(false)
    expect(themeDataAttributes(bootstrapFixture().theme)['data-sf-button-hover']).toBe('auto')
  })

  it('the default theme’s variables equal the stylesheet defaults (no flash, no change)', async () => {
    const root = await rootVars()
    const vars = themeToCssVars(bootstrapFixture().theme)
    const derived = ['--sf-button', '--sf-button-foreground', '--sf-button-hover', '--sf-link', '--sf-star-on-dark']
    const shared = Object.keys(root).filter((name) => name in vars && !name.startsWith('--sf-font-') && !derived.includes(name))
    expect(shared.length).toBeGreaterThan(25)
    for (const name of shared) expect([name, vars[name]]).toEqual([name, root[name]])
    // The role defaults in the sheet point at their source colours.
    expect(root).toMatchObject({ '--sf-button': 'var(--sf-primary)', '--sf-button-foreground': 'var(--sf-primary-foreground)', '--sf-link': 'var(--sf-accent)', '--sf-heading-mobile': '1' })
  })

  it('maps the B3 colour roles; a null hover keeps the automatic hover', () => {
    const base = bootstrapFixture().theme
    const themed = { ...base, colors: { ...base.colors, button: '#1d4ed8', button_foreground: '#ffffff', button_hover: '#1e3a8a', link: '#be123c' } }
    expect(themeToCssVars(themed)).toMatchObject({ '--sf-button': '#1d4ed8', '--sf-button-foreground': '#ffffff', '--sf-button-hover': '#1e3a8a', '--sf-link': '#be123c', '--sf-primary': '#f59e0b' })
    expect(themeDataAttributes(themed)['data-sf-button-hover']).toBe('color')
    const nulls = { ...base, colors: { ...base.colors, button: null, button_foreground: null, button_hover: null, link: null } }
    expect(themeToCssVars(nulls)).toMatchObject({ '--sf-button': '#f59e0b', '--sf-button-foreground': '#3b2500', '--sf-link': '#6f55c2' })
    expect(themeDataAttributes(nulls)['data-sf-button-hover']).toBe('auto')
  })

  it('scales body steps with the body size and heading steps on the modular scale', () => {
    const base = bootstrapFixture().theme
    const vars = themeToCssVars({ ...base, typography: { ...base.typography, body_size: 18, heading_scale: 1.4, line_height: 1.8, heading_weight: 600, mobile_scale: 0.9, letter_spacing: -0.01 } })
    expect(vars['--sf-text-base']).toBe('1.125rem')
    expect(vars['--sf-text-sm']).toBe('0.9844rem')
    // xl is one step: 18 × 1.4 = 25.2 px.
    expect(vars['--sf-text-xl']).toBe('1.575rem')
    expect(Number.parseFloat(vars['--sf-text-4xl']!)).toBeGreaterThan(2.25 * 1.4)
    expect(vars['--sf-line-height']).toBe('1.8')
    expect(vars['--sf-leading-factor']).toBe('1.2')
    expect(vars['--sf-mobile-scale']).toBe('0.9')
    expect(vars['--sf-heading-weight-shift']).toBe('-100')
    expect(vars['--sf-heading-letter-spacing']).toBe('-0.01em')
    expect(vars['--sf-heading-tracking']).toBe('-0.01em')
    // Uppercase headings add the theme's spacing to their own.
    expect(themeToCssVars({ ...base, typography: { ...base.typography, letter_spacing: 0.02 }, layout: { ...base.layout, heading_case: 'uppercase' } })['--sf-heading-tracking']).toBe('0.06em')
  })

  it('clamps out-of-range values and ignores non-numbers', () => {
    expect(resolveTypeScale({ body_size: 40, heading_scale: 0.5, line_height: Number.NaN })).toEqual({ ...TYPE_DEFAULTS, body_size: 20, heading_scale: 1.1 })
    expect(typeSamples({})[0]).toEqual({ label: 'Page & section titles', desktop: 36, phone: 30, heading: true })
    expect(headingStepPx(36, resolveTypeScale({}))).toBe(36)
  })
})

describe('draft preview', () => {
  it('asks the bootstrap for the draft theme when the store URL has ?preview=draft', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(String(url))
        return new Response(JSON.stringify({ success: true, data: bootstrapFixture(), meta: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }),
    )
    window.history.replaceState(null, '', '/?preview=draft')
    try {
      expect(isDraftPreviewUrl()).toBe(true)
      await fetchBootstrap(null)
      expect(calls.at(-1)).toContain('preview=draft')
      window.history.replaceState(null, '', '/shop')
      await fetchBootstrap(null)
      expect(calls.at(-1)).not.toContain('preview')
    } finally {
      window.history.replaceState(null, '', '/')
      vi.unstubAllGlobals()
    }
  })
})
