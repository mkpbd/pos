import { describe, expect, it } from 'vitest'
import type { Column, Element, Section, WrappedElement } from '@/storefront/builder/types'
import { ELEMENT_REGISTRY } from '@/storefront/builder/registry'
import { buildElement, needsSetup, newId } from './create-element'
import { errorMap, formKey, isInlineProblem, localPath } from './errors'
import { withBangla } from './bangla'
import { collectIds, currentPreset, findParent, otherAnchors } from './tree-lookup'
import type { BuilderContent, ElementsMetadata } from './types'
import { validateNode } from './validate'

const registry: ElementsMetadata = { types: [...ELEMENT_REGISTRY], limits: {}, enums: {} }
const common = { style: {}, visibility: { desktop: true, tablet: true, mobile: true }, hidden: false, schedule: null, translations: {} }

const el = (type: string, props: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ id: 'e_test01', type, props, ...common, ...extra }) as unknown as Element
const wrapped = (type: string, config: Record<string, unknown>, items: { item_type: string; item_id: string }[] = [], extra: Record<string, unknown> = {}) =>
  el(type, { title: null, subtitle: null, config, items }, extra) as WrappedElement
const paths = (node: Parameters<typeof validateNode>[0]) => validateNode(node).map((p) => p.path)
const UUID = '0b6f2e3c-1a2b-4c3d-8e9f-0123456789ab'
const UUID2 = '1b6f2e3c-1a2b-4c3d-8e9f-0123456789ab'
const UUID3 = '2b6f2e3c-1a2b-4c3d-8e9f-0123456789ab'

describe('validateNode: builder elements', () => {
  it('accepts every registry default except the wrapped sections that need content', () => {
    const needContent = ['hero_slider', 'banner_grid', 'rich_text', 'features_strip', 'testimonials', 'product_tabs']
    for (const meta of ELEMENT_REGISTRY) {
      const node = buildElement(meta.type, registry, new Set())!
      expect(validateNode(node).length > 0, meta.type).toBe(needContent.includes(meta.type))
    }
  })

  it('checks heading text, level and link', () => {
    expect(paths(el('heading', { text: '  ', level: 2, link: null }))).toEqual(['props.text'])
    expect(paths(el('heading', { text: 'x'.repeat(201), level: 7, link: { url: 'javascript:alert(1)' } }))).toEqual(['props.text', 'props.level', 'props.link'])
    expect(paths(el('heading', { text: 'Hi', level: 1, link: { url: 'https://example.com/a' } }))).toEqual([])
  })

  it('requires a button label and a safe link', () => {
    expect(validateNode(el('button', { label: '', link: { url: '' }, variant: 'primary', size: 'md', full_width: false }))).toEqual([
      { path: 'props.label', message: 'Enter the button text.' },
      { path: 'props.link', message: 'Choose where the button leads.' },
    ])
    expect(paths(el('button', { label: 'Go', link: { url: '//evil.test' }, variant: 'huge', size: 'md', full_width: false }))).toEqual(['props.link', 'props.variant'])
  })

  it('checks image media id, alt length and enums', () => {
    expect(paths(el('image', { media_id: null, alt: '', link: null, aspect: 'auto', fit: 'cover' }))).toEqual([])
    expect(paths(el('image', { media_id: 'nope', alt: 'a'.repeat(201), link: null, aspect: '2:1', fit: 'cover' }))).toEqual(['props.media_id', 'props.alt', 'props.aspect'])
  })

  it('checks divider ranges and colours', () => {
    const divider = { line: 'solid', thickness: 1, width: 100, color: 'theme:border', align: 'center' }
    expect(paths(el('divider', divider))).toEqual([])
    expect(paths(el('divider', { ...divider, color: '#abcdef' }))).toEqual([])
    expect(paths(el('divider', { ...divider, thickness: 11, width: 5, color: 'red' }))).toEqual(['props.thickness', 'props.width', 'props.color'])
  })

  it('checks section layout, anchor and columns, and column widths', () => {
    const column: Column = { id: 'c_aaaaaa', type: 'column', width: { base: 100 }, style: {}, elements: [] }
    const section = { id: 's_aaaaaa', type: 'section', props: { layout: 'boxed', anchor: 'offers' }, columns: [column], ...common } as Section
    expect(validateNode(section)).toEqual([])
    expect(paths({ ...section, props: { layout: 'wide', anchor: 'Bad Anchor' }, columns: [] } as unknown as Section)).toEqual(['props.layout', 'props.anchor', 'columns'])
    expect(paths({ ...column, width: { base: 4, mobile: 100.001 } })).toEqual(['width.base', 'width.mobile'])
  })

  it('checks the schedule and translation lengths', () => {
    const base = el('heading', { text: 'Hi', level: 2, link: null })
    expect(paths({ ...base, schedule: { starts_at: '2026-12-02T00:00:00+06:00', ends_at: '2026-12-01T00:00:00+06:00' } })).toEqual(['schedule.ends_at'])
    expect(paths({ ...base, schedule: { starts_at: 'tomorrow', ends_at: null } })).toEqual(['schedule.starts_at'])
    expect(paths({ ...base, translations: { bn: { text: 'ক'.repeat(201) } } })).toEqual(['translations.bn.text'])
  })
})

describe('validateNode: wrapped sections (homepage rules)', () => {
  it('needs banners for sliders and grids, per layout', () => {
    expect(validateNode(wrapped('hero_slider', { autoplay_seconds: 6, height: 'large' }))).toEqual([{ path: 'props.items', message: 'Choose 1 to 10 banners.' }])
    const banners = [UUID, UUID2, UUID3].map((item_id) => ({ item_type: 'banner', item_id }))
    expect(validateNode(wrapped('banner_grid', { layout: '3-col' }, banners))).toEqual([])
    expect(validateNode(wrapped('banner_grid', { layout: '3-col-split' }, banners))).toEqual([{ path: 'props.items', message: 'Choose exactly 4 banners.' }])
  })

  it('needs 2–5 product tabs with labels and categories', () => {
    expect(paths(wrapped('product_tabs', { tabs: [], limit: 8 }))).toEqual(['props.config.tabs'])
    const tabs = [
      { label: 'New', source: 'new_arrivals', category_id: null },
      { label: '', source: 'category', category_id: null },
    ]
    expect(paths(wrapped('product_tabs', { tabs, limit: 8 }))).toEqual(['props.config.tabs.1.label', 'props.config.tabs.1.category_id'])
  })

  it('needs hand-picked products only with the manual source', () => {
    const config = { source: 'manual', category_id: null, limit: 8, columns: 4, view_all_url: null }
    expect(validateNode(wrapped('product_grid', config))).toEqual([{ path: 'props.items', message: 'Pick at least one product.' }])
    expect(validateNode(wrapped('product_grid', config, [{ item_type: 'product', item_id: UUID }]))).toEqual([])
    expect(validateNode(wrapped('product_grid', { ...config, source: 'featured', limit: 30, view_all_url: 'ftp://x' }))).toEqual([
      { path: 'props.config.limit', message: 'Between 4 and 24.' },
      { path: 'props.config.view_all_url', message: 'Use a site path such as /shop or an http(s) URL.' },
    ])
  })

  it('checks text blocks, features, testimonials and the newsletter', () => {
    expect(paths(wrapped('rich_text', { body_html: '', alignment: 'left', width: 'narrow', background: 'blue' }))).toEqual(['props.config.body_html', 'props.config.background'])
    expect(paths(wrapped('features_strip', { items: [{ icon: 'star', title: ' ', text: null }], background: null }))).toEqual(['props.config.items.0.title'])
    expect(paths(wrapped('testimonials', { items: [], background: null }))).toEqual(['props.config.items'])
    expect(paths(wrapped('newsletter', { text: null, button_label: '', image_media_id: null, background: '#c2410c', foreground: 'white' }))).toEqual(['props.config.button_label', 'props.config.foreground'])
  })

  it('limits titles and Bangla texts', () => {
    const node = wrapped('blog_posts', { category_id: null, limit: 3, view_all_url: '/blog' }, [], { translations: { bn: { title: 'ক'.repeat(121) } } })
    expect(paths({ ...node, props: { ...node.props, title: 't'.repeat(121) } })).toEqual(['props.title', 'translations.bn.title'])
  })
})

describe('createElement helpers', () => {
  it('builds elements with fresh ids and friendly starting texts', () => {
    const taken = new Set(['e_aaaaaa'])
    const heading = buildElement('heading', registry, taken)!
    expect(heading).toMatchObject({ type: 'heading', props: { text: 'Your heading', level: 2, link: null }, hidden: false, schedule: null, translations: {} })
    expect(heading.id).toMatch(/^e_[a-z0-9]{6}$/)
    expect(taken.has(heading.id)).toBe(false) // the caller's set is not changed
    expect(buildElement('text', registry, taken)).toMatchObject({ props: { html: '<p>Write something.</p>' } })
    expect(buildElement('button', registry, taken)).toMatchObject({ props: { label: 'Shop now', link: { url: '/shop' } } })
    expect(buildElement('nope', registry, taken)).toBeNull()
  })

  it('builds an inner row with two columns', () => {
    const row = buildElement('inner_row', registry, new Set())!
    expect(row.type).toBe('inner_row')
    const columns = (row as { columns: Column[] }).columns
    expect(columns).toHaveLength(2)
    expect(columns.map((c) => c.width)).toEqual([{ base: 50, tablet: 50, mobile: 100 }, { base: 50, tablet: 50, mobile: 100 }])
    expect(new Set([row.id, ...columns.map((c) => c.id)]).size).toBe(3)
    expect(validateNode(row)).toEqual([])
  })

  it('makes unique ids', () => {
    const taken = new Set<string>()
    for (let i = 0; i < 200; i++) newId('e', taken)
    expect(taken.size).toBe(200)
  })

  it('knows which wrapped types need setup', () => {
    expect(needsSetup(buildElement('hero_slider', registry, new Set())!)).toBe(true)
    expect(needsSetup(buildElement('product_grid', registry, new Set())!)).toBe(false)
    expect(needsSetup(buildElement('heading', registry, new Set())!)).toBe(false)
  })
})

describe('problem paths and tree lookups', () => {
  const heading = el('heading', { text: 'Hi', level: 2, link: null })
  const grid = wrapped('banner_grid', { layout: '3-col' })
  const products = wrapped('product_grid', { source: 'manual' })

  it('maps document and node paths to form keys', () => {
    expect(localPath('sections.0.columns.1.elements.2.props.text')).toBe('props.text')
    expect(localPath('sections.0.columns.1.elements.0.columns.0.elements.3.translations.bn.text')).toBe('translations.bn.text')
    expect(formKey(heading, 'props.link.url')).toBe('link')
    expect(formKey(heading, 'schedule.ends_at')).toBe('ends_at')
    expect(formKey(grid, 'props.items.2')).toBe('banner_ids')
    expect(formKey(products, 'props.items')).toBe('item_ids')
    expect(formKey(products, 'props.config.limit')).toBe('config.limit')
    expect(errorMap(heading, [{ path: 'props.text', message: 'client' }], [{ path: 'props.text', message: 'server' }])).toEqual({ text: 'server' })
  })

  it('tells inline problems from the rest', () => {
    expect(isInlineProblem(grid, { path: 'props.items', message: 'x', code: 'BANNER_NOT_FOUND', ids: [UUID] }, false)).toBe(true)
    expect(isInlineProblem(heading, { path: 'translations.bn.text', message: 'x' }, false)).toBe(false)
    expect(isInlineProblem(heading, { path: 'translations.bn.text', message: 'x' }, true)).toBe(true)
    expect(isInlineProblem(heading, { path: 'style.base.color', message: 'x' }, true)).toBe(false)
    expect(isInlineProblem(heading, { path: 'id', message: 'x' }, true)).toBe(false)
  })

  it('finds parents, presets, ids and anchors', () => {
    const inner = { id: 'e_row001', type: 'inner_row', props: {}, ...common, columns: [{ id: 'c_in0001', type: 'column', width: { base: 100 }, style: {}, elements: [heading] }] }
    const content: BuilderContent = {
      schema_version: 1,
      sections: [
        { id: 's_one001', type: 'section', props: { layout: 'boxed', anchor: 'top' }, ...common, columns: [{ id: 'c_one001', type: 'column', width: { base: 33.33 }, style: {}, elements: [inner as unknown as Element] }, { id: 'c_one002', type: 'column', width: { base: 66.67 }, style: {}, elements: [] }] },
        { id: 's_two001', type: 'section', props: { layout: 'boxed', anchor: 'offers' }, ...common, columns: [] },
      ],
    }
    expect(findParent(content, 'e_test01')?.id).toBe('c_in0001')
    expect(findParent(content, 'c_in0001')?.id).toBe('e_row001')
    expect(findParent(content, 'e_row001')?.id).toBe('c_one001')
    expect(findParent(content, 'c_one002')?.id).toBe('s_one001')
    expect(findParent(content, 's_one001')).toBeNull()
    expect(currentPreset(content.sections[0]!.columns)).toBe('1-2')
    expect(currentPreset([{ width: { base: 40 } }, { width: { base: 60 } }])).toBeNull()
    expect(collectIds(content).size).toBe(7)
    expect([...otherAnchors(content, 's_one001')]).toEqual(['offers'])
  })

  it('writes Bangla translations without blanks', () => {
    expect(withBangla({}, { text: 'হ্যালো', other: ' ' })).toEqual({ bn: { text: 'হ্যালো' } })
    expect(withBangla({ bn: { text: 'x' } }, { text: '' })).toEqual({})
  })
})
