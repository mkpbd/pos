import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { THEME_PRESETS } from '@/features/storefront/api'
import { PRESET_LABELS } from '@/features/store-builder/templates/model'
import { TEMPLATE_PRESETS } from '@/features/store-builder/templates/api'
import { TemplateThumbnail } from '@/features/store-builder/templates/template-thumbnail'
import { mockApi, ok, renderRoutes } from '@/test/utils'
import type { DemoStore } from './demos/api'
import { galleryColumns } from './demos/grid'
import { B11_PRESETS, DEMO_PRESETS, DEMO_PRESET_LABELS, THEME_PRESET_KEYS, isDemoPreset, isThemePresetKey } from './demos/presets'
import { demos as bnDemos } from './i18n/bn/demos'
import { demos as enDemos } from './i18n/en/demos'
import { storefrontRoutes } from './routes'
import { bootstrapFixture, resetLocale } from './test-fixtures'
import { resolveLayout, themeDataAttributes, themeToCssVars } from './theme'
import type { LayoutVariants, StorefrontTheme } from './types'

/*
 * B11: five new demo looks (fashion, electronics, grocery, beauty, furniture). They reuse the T1
 * layout options and the B10 fonts, so the storefront side is the preset lists, the labels, the
 * gallery of nine stores and the two builder pictures per look made from the seeded stores
 * (section templates have none: the drawn placeholder).
 */

/** The new presets' layouts and fonts as the backend defines them (ThemePresets.php, B11 contract). */
const LOOKS: Record<(typeof B11_PRESETS)[number], { heading: string; body: string; layout: LayoutVariants }> = {
  fashion: { heading: 'playfair', body: 'poppins', layout: { header_style: 'standard', footer_style: 'widgets', card_style: 'minimal', hero_style: 'full', heading_case: 'uppercase', top_bar: 'ticker' } },
  electronics: { heading: 'poppins', body: 'system', layout: { header_style: 'commerce', footer_style: 'columns', card_style: 'commerce', hero_style: 'sale', heading_case: 'normal', top_bar: 'utility' } },
  grocery: { heading: 'anek-bangla', body: 'hind-siliguri', layout: { header_style: 'commerce', footer_style: 'columns', card_style: 'standard', hero_style: 'full', heading_case: 'normal', top_bar: 'ticker' } },
  beauty: { heading: 'tiro-bangla', body: 'jost', layout: { header_style: 'standard', footer_style: 'showcase', card_style: 'standard', hero_style: 'tiles', heading_case: 'normal', top_bar: 'ticker' } },
  furniture: { heading: 'jost', body: 'poppins', layout: { header_style: 'centered', footer_style: 'showcase', card_style: 'minimal', hero_style: 'full', heading_case: 'normal', top_bar: 'utility' } },
}

const STORES: { preset: string; name: string; heading_font: string; family: RegExp }[] = [
  { preset: 'vegan', name: 'Green Basket', heading_font: 'baloo', family: /Baloo 2 Variable/ },
  { preset: 'handmade', name: 'Mati & Co.', heading_font: 'playfair', family: /Playfair Display/ },
  { preset: 'classic', name: 'Classic Shop', heading_font: 'jost', family: /Jost/ },
  { preset: 'kids', name: 'Little Sprouts', heading_font: 'baloo', family: /Baloo 2 Variable/ },
  { preset: 'fashion', name: 'Loom & Lane', heading_font: 'playfair', family: /Playfair Display/ },
  { preset: 'electronics', name: 'Circuit Bazar', heading_font: 'poppins', family: /Poppins/ },
  { preset: 'grocery', name: 'Bazar Fresh', heading_font: 'anek-bangla', family: /Anek Bangla/ },
  { preset: 'beauty', name: 'Blush & Bloom', heading_font: 'tiro-bangla', family: /Tiro Bangla/ },
  { preset: 'furniture', name: 'Kath & Home', heading_font: 'jost', family: /Jost/ },
]

const demoStore = (store: (typeof STORES)[number]): DemoStore => ({
  host: `${store.preset}.shop.localhost`,
  name: store.name,
  preset: store.preset,
  tagline: null,
  colors: { primary: '#1c1917', accent: '#9f1239', canvas: '#faf7f2' },
  heading_font: store.heading_font,
  image_url: `/storage/media/${store.preset}/hero.jpg`,
  product_count: 20,
  category_names: ['One', 'Two'],
})

afterEach(() => {
  resetLocale()
  document.title = ''
  document.head.querySelectorAll('meta[name="robots"]').forEach((meta) => meta.remove())
})

/** Files on disk (vitest stubs asset imports). A runtime specifier keeps Node types out of the app build. */
async function disk(): Promise<{ exists(path: string): boolean; read(path: string): string; size(path: string): number }> {
  const fsModule = 'node:fs'
  const fs = (await import(/* @vite-ignore */ fsModule)) as { existsSync(p: string): boolean; readFileSync(p: string, e: 'utf8'): string; statSync(p: string): { size: number } }
  const root = (globalThis as unknown as { process: { cwd(): string } }).process.cwd()
  const at = (path: string) => `${root}/${path}`
  return { exists: (p) => fs.existsSync(at(p)), read: (p) => fs.readFileSync(at(p), 'utf8'), size: (p) => fs.statSync(at(p)).size }
}

describe('B11 demo looks: the preset lists', () => {
  it('lists nine demo looks once; the theme, the admin form and the builder read the same list', () => {
    expect(DEMO_PRESETS).toEqual(['vegan', 'handmade', 'classic', 'kids', 'fashion', 'electronics', 'grocery', 'beauty', 'furniture'])
    expect(THEME_PRESET_KEYS).toEqual(['default', ...DEMO_PRESETS])
    expect(THEME_PRESETS).toBe(THEME_PRESET_KEYS)
    expect(TEMPLATE_PRESETS).toBe(DEMO_PRESETS)
    expect(PRESET_LABELS).toBe(DEMO_PRESET_LABELS)
    for (const preset of B11_PRESETS) {
      expect(isDemoPreset(preset)).toBe(true)
      expect(isThemePresetKey(preset)).toBe(true)
    }
    expect(isDemoPreset('default')).toBe(false)
    expect(isThemePresetKey('default')).toBe(true)
    for (const other of ['toys', '', null, undefined]) expect(isThemePresetKey(other)).toBe(false)
  })

  it('every demo look has a gallery label in English and Bangla', () => {
    const en = enDemos as Record<string, unknown>
    const bn = bnDemos as Record<string, unknown>
    for (const preset of DEMO_PRESETS) {
      expect(en[`demos.preset.${preset}`], preset).toEqual(expect.any(String))
      expect(bn[`demos.preset.${preset}`], preset).toEqual(expect.any(String))
      expect(bn[`demos.preset.${preset}`]).not.toBe(en[`demos.preset.${preset}`])
    }
    expect(B11_PRESETS.map((p) => en[`demos.preset.${p}`])).toEqual(['Fashion', 'Electronics', 'Grocery', 'Beauty', 'Furniture'])
  })

  it('the new presets need no layout code: every layout value is an existing T1 option, marked on the page', () => {
    const base = bootstrapFixture().theme
    for (const preset of B11_PRESETS) {
      const look = LOOKS[preset]
      const theme: StorefrontTheme = { ...base, preset, typography: { ...base.typography, heading_font: look.heading, body_font: look.body } as StorefrontTheme['typography'], layout: { ...base.layout, ...look.layout } }
      expect(resolveLayout(theme.layout), preset).toEqual(look.layout)
      expect(themeDataAttributes(theme)).toMatchObject({ 'data-sf-preset': preset, 'data-sf-card': look.layout.card_style, 'data-sf-header': look.layout.header_style })
      // The B10 fonts resolve to their stacks (not the system fallback).
      const vars = themeToCssVars(theme)
      if (look.heading !== 'system') expect(vars['--sf-font-heading']).not.toMatch(/^system-ui/)
    }
    expect(themeToCssVars({ ...base, layout: { ...base.layout, heading_case: 'uppercase' } })['--sf-heading-transform']).toBe('uppercase')
  })
})

describe('B11 demo gallery: nine stores', () => {
  it('picks columns so no row ends with a lone card', () => {
    expect(galleryColumns(9)).toBe('md:grid-cols-3')
    expect(galleryColumns(3)).toBe('md:grid-cols-3')
    expect(galleryColumns(4)).toBe('sm:grid-cols-2 xl:grid-cols-4')
    expect(galleryColumns(8)).toBe('sm:grid-cols-2 xl:grid-cols-4')
    expect(galleryColumns(2)).toBe('sm:grid-cols-2')
    expect(galleryColumns(10)).toBe('sm:grid-cols-2')
    expect(galleryColumns(1)).toBe('')
    expect(galleryColumns(5)).toBe('sm:grid-cols-2 lg:grid-cols-3')
  })

  it('lists the nine demo stores as 3 × 3, each with its theme name, heading font and own host', async () => {
    mockApi({ 'GET /demo-stores': ok(STORES.map(demoStore)) })
    renderRoutes(storefrontRoutes, '/demos')

    const list = await screen.findByRole('list', { name: 'Demo stores' })
    expect(within(list).getAllByRole('article')).toHaveLength(9)
    expect(list).toHaveClass('grid-cols-1', 'md:grid-cols-3')
    expect(list).not.toHaveClass('xl:grid-cols-4')
    const port = window.location.port ? `:${window.location.port}` : ''
    const labels: Record<string, string> = { fashion: 'Fashion', electronics: 'Electronics', grocery: 'Grocery', beauty: 'Beauty', furniture: 'Furniture' }
    for (const store of STORES.slice(4)) {
      const card = within(list).getByRole('article', { name: store.name })
      expect(card).toHaveAttribute('data-preset', store.preset)
      expect(within(card).getByText(`Theme: ${labels[store.preset]}`)).toBeInTheDocument()
      expect(within(card).getByRole('heading', { level: 2 }).style.fontFamily).toMatch(store.family)
      expect(within(card).getByRole('link', { name: `Open store: ${store.name}` })).toHaveAttribute('href', `${window.location.protocol}//${store.preset}.shop.localhost${port}/`)
    }
    expect(document.body.textContent).not.toMatch(/@|password/i)
  })
})

describe('B11 builder pictures', () => {
  it('each new look has a small card picture and tall home page preview, made from the seeded store', async () => {
    const files = await disk()
    for (const preset of B11_PRESETS) {
      const thumbnail = `public/builder-templates/site-${preset}.png`
      const preview = `public/builder-templates/site-${preset}-full.jpg`
      for (const file of [thumbnail, preview]) expect(files.exists(file), file).toBe(true)
      expect(files.size(thumbnail), thumbnail).toBeGreaterThan(5_000)
      expect(files.size(thumbnail), thumbnail).toBeLessThanOrEqual(120 * 1024)
      expect(files.size(preview), preview).toBeGreaterThan(20_000)
      expect(files.size(preview), preview).toBeLessThanOrEqual(400 * 1024)
    }
  })

  it('the template manifest names those pictures; section templates have a picture that exists or none (the drawn placeholder)', async () => {
    const files = await disk()
    const manifest = JSON.parse(files.read('../backend/resources/builder-templates/manifest.json')) as {
      templates: { id: string; scope: string; preset: string | null; thumbnail?: string | null; preview?: string | null }[]
    }
    for (const preset of B11_PRESETS) {
      const own = manifest.templates.filter((t) => t.preset === preset)
      const site = own.find((t) => t.scope === 'site')
      expect(site?.id, preset).toBe(`site-${preset}`)
      expect(site?.thumbnail).toBe(`/builder-templates/site-${preset}.png`)
      expect(site?.preview).toBe(`/builder-templates/site-${preset}-full.jpg`)
      expect(own.filter((t) => t.scope === 'section').length, preset).toBeGreaterThanOrEqual(6)
      for (const template of own) {
        for (const path of [template.thumbnail, template.preview].filter((p): p is string => typeof p === 'string')) expect(files.exists(`public${path}`), path).toBe(true)
      }
    }
  })

  it('a section template without a picture shows a neat sketch with its name and category, never a broken image', () => {
    const template = { id: 'fashion-style-story', scope: 'section' as const, category: 'story', name: 'Style story', thumbnail_url: null }
    const { unmount } = render(<TemplateThumbnail template={template} />)
    const placeholder = screen.getByTestId('template-placeholder')
    expect(placeholder).toHaveTextContent('Style story')
    expect(within(placeholder).getByTestId('template-placeholder-category')).toHaveTextContent('About / story')
    expect(placeholder.querySelector('img')).toBeNull()
    unmount()

    // A picture that fails to load falls back to the same sketch.
    render(<TemplateThumbnail template={{ ...template, id: 'grocery-aisles', category: 'categories', name: 'Shop the aisles', thumbnail_url: '/builder-templates/missing.png' }} />)
    fireEvent.error(document.querySelector('img')!)
    expect(screen.getByTestId('template-placeholder')).toHaveTextContent('Shop the aisles')
    expect(screen.getByTestId('template-placeholder-category')).toHaveTextContent('Categories')
  })
})
