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
  it('accepts every registry default except the elements that need content first', () => {
    // B4: a video needs its link, a promoted product its product, a countdown its end, a discount its promotion, a menu its menu.
    // B6: images, logos, a map address, a category, a product and the shop-the-look photo.
    // B8a: the before / after photos, the bundle's products and the photo grid's photos.
    const needContent = [
      'hero_slider', 'banner_grid', 'rich_text', 'features_strip', 'testimonials', 'product_tabs', 'video', 'promo_card', 'countdown', 'discount', 'menu',
      'gallery', 'image_carousel', 'logo_carousel', 'map', 'category_card', 'product_spotlight', 'shop_the_look',
      'before_after', 'bundle', 'photo_grid',
    ]
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

describe('validateNode: B4 elements', () => {
  const b4 = (type: string, props: Record<string, unknown> = {}) => {
    const base = buildElement(type, registry, new Set())!
    return { ...base, id: 'e_test01', props: { ...base.props, ...props } } as unknown as Element
  }

  it('video: YouTube watch / youtu.be / Shorts and Vimeo links; a title; start 0–86400', () => {
    for (const url of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtu.be/dQw4w9WgXcQ', 'https://youtube.com/shorts/dQw4w9WgXcQ', 'https://vimeo.com/76979871']) {
      expect(paths(b4('video', { url, title: 'Clip' })), url).toEqual([])
    }
    expect(paths(b4('video', { url: 'https://example.com/v.mp4', title: 'Clip' }))).toEqual(['props.url'])
    expect(paths(b4('video', { url: `https://youtu.be/dQw4w9WgXcQ?x=${'a'.repeat(500)}`, title: 'Clip' }))).toEqual(['props.url'])
    expect(paths(b4('video', { url: 'https://youtu.be/dQw4w9WgXcQ', title: ' ', start: 90_000, aspect: '2:1' }))).toEqual(['props.title', 'props.aspect', 'props.start'])
  })

  it('icon: a known name, size 16–128, colour, optional link', () => {
    expect(paths(b4('icon'))).toEqual([])
    expect(paths(b4('icon', { name: 'rocket', size: 8, color: 'red', link: { url: 'javascript:x' } }))).toEqual(['props.name', 'props.size', 'props.color', 'props.link'])
    // The server's icon list wins when the editor has it.
    expect(validateNode(b4('icon', { name: 'rocket' }), { icons: ['rocket'] })).toEqual([])
  })

  it('countdown: an instant for the date source, a promotion for the promotion source', () => {
    expect(paths(b4('countdown'))).toEqual(['props.ends_at'])
    expect(paths(b4('countdown', { ends_at: '2026-12-01T18:30:00+06:00' }))).toEqual([])
    expect(paths(b4('countdown', { source: 'promotion' }))).toEqual(['props.promotion_id'])
    expect(paths(b4('countdown', { source: 'promotion', promotion_id: UUID, style: 'big' }))).toEqual(['props.style'])
  })

  it('discount, promoted product and menu need their record', () => {
    expect(paths(b4('discount'))).toEqual(['props.promotion_id'])
    expect(paths(b4('discount', { promotion_id: UUID, button_label: 'x'.repeat(61) }))).toEqual(['props.button_label'])
    expect(paths(b4('promo_card'))).toEqual(['props.product_id'])
    expect(paths(b4('promo_card', { product_id: UUID, badge: 'x'.repeat(25) }))).toEqual(['props.badge'])
    expect(paths(b4('menu'))).toEqual(['props.menu_id'])
    expect(paths(b4('menu', { menu_id: UUID, show_children: 'list' }))).toEqual([])
  })

  it('call to action: title and both buttons need text and a link', () => {
    expect(paths(b4('cta'))).toEqual([])
    expect(paths(b4('cta', { title: '', primary: { label: '', link: { url: '' } }, secondary: { label: 'More', link: { url: 'ftp://x' } }, align: 'top' }))).toEqual([
      'props.title',
      'props.primary.label',
      'props.primary.link',
      'props.secondary.link',
      'props.align',
    ])
  })

  it('site parts: bounds and enums', () => {
    for (const type of ['logo', 'account_link', 'wishlist_link', 'cart_icon', 'language_switch', 'announcement', 'social_icons', 'payment_icons', 'contact_block', 'copyright', 'newsletter_form', 'faq_list', 'contact_form', 'search_box', 'custom_html']) {
      expect(paths(b4(type)), type).toEqual([])
    }
    expect(paths(b4('logo', { height: 100 }))).toEqual(['props.height'])
    expect(paths(b4('social_icons', { size: 50, style: 'round' }))).toEqual(['props.size', 'props.style'])
    expect(paths(b4('payment_icons', { height: 10 }))).toEqual(['props.height'])
    expect(paths(b4('contact_block', { show_phone: 'yes', layout: 'grid' }))).toEqual(['props.show_phone', 'props.layout'])
    expect(paths(b4('copyright', { text: 'x'.repeat(201) }))).toEqual(['props.text'])
    expect(paths(b4('newsletter_form', { button_label: '' }))).toEqual(['props.button_label'])
    expect(paths(b4('custom_html', { html: 'x'.repeat(20_001) }))).toEqual(['props.html'])
  })

  it('B4 translations use the same limits, nested labels by dot key', () => {
    expect(paths({ ...b4('cta'), translations: { bn: { 'primary.label': 'x'.repeat(61), title: 'ঠিক' } } })).toEqual(['translations.bn.primary.label'])
    expect(paths({ ...b4('video', { url: 'https://youtu.be/dQw4w9WgXcQ', title: 'Clip' }), translations: { bn: { title: 'x'.repeat(201) } } })).toEqual(['translations.bn.title'])
  })

  it('maps nested and derived props to their form fields', () => {
    expect(formKey(b4('cta'), 'sections.0.columns.0.elements.0.props.primary.link.url')).toBe('primary.link')
    expect(formKey(b4('cta'), 'props.secondary.label')).toBe('secondary.label')
    expect(formKey(b4('video'), 'props.video_id')).toBe('url')
    expect(isInlineProblem(b4('video'), { path: 'props.provider', message: 'x' }, false)).toBe(true)
    expect(isInlineProblem(b4('custom_html'), { path: '', message: 'Not allowed' }, false)).toBe(false)
  })
})

describe('validateNode: B8a elements', () => {
  const b8 = (type: string, props: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => {
    const base = buildElement(type, registry, new Set())!
    return { ...base, id: 'e_test01', props: { ...base.props, ...props }, ...extra } as unknown as Element
  }
  const message = (node: Element, path: string) => validateNode(node).find((p) => p.path === path)?.message

  it('pricing: a price is a money string; a word is needed instead of no price; plans and features have limits', () => {
    const plan = (over: Record<string, unknown>) => ({ id: 'p_a', name: 'Basic', price: '10', price_text: '', period: '', description: '', features: [], button: null, highlighted: false, badge: '', ...over })
    expect(paths(b8('pricing_table', { plans: [plan({ price: '-1' })] }))).toEqual(['props.plans.0.price'])
    expect(message(b8('pricing_table', { plans: [plan({ price: '1.234' })] }), 'props.plans.0.price')).toMatch(/1250 or 99.50/)
    expect(message(b8('pricing_table', { plans: [plan({ price: null })] }), 'props.plans.0.price_text')).toMatch(/instead of a price/)
    expect(message(b8('pricing_table', { plans: [] }), 'props.plans')).toBe('Add at least 1 plan.')
    const features = Array.from({ length: 13 }, (_, i) => ({ id: `f_${i}x`, text: 'F', included: true }))
    expect(message(b8('pricing_table', { plans: [plan({ features })] }), 'props.plans.0.features')).toBe('At most 12 features.')
    expect(message(b8('pricing_table', { plans: [plan({ button: { label: 'Go', url: 'javascript:alert(1)' } })] }), 'props.plans.0.button.url')).toMatch(/site path/)
  })

  it('comparison: the same product twice and an empty text cell are reported', () => {
    const columns = [
      { id: 'c_a', title: 'A', product_id: UUID, highlighted: false },
      { id: 'c_b', title: 'B', product_id: UUID, highlighted: false },
    ]
    const rows = [{ id: 'r_a', label: 'Warranty', cells: { c_a: { kind: 'text', text: ' ' }, c_b: { kind: 'yes', text: '' } } }]
    const node = b8('comparison_table', { columns, rows })
    expect(message(node, 'props.columns.1.product_id')).toMatch(/already in another column/)
    expect(message(node, 'props.rows.0.cells.c_a.text')).toMatch(/Enter the text for this cell/)
  })

  it('team: a name is needed (not translated); links by kind; store hours times; progress values', () => {
    const member = (links: unknown[]) => ({ id: 'm_a', media_id: null, name: 'Rina', role: '', bio: '', links })
    expect(paths(b8('team', { members: [member([{ id: 'l_a', kind: 'email', url: 'mailto:rina@shop.com' }, { id: 'l_b', kind: 'website', url: 'https://shop.com' }])] }))).toEqual([])
    expect(message(b8('team', { members: [member([{ id: 'l_a', kind: 'facebook', url: 'http://fb.com/x' }])] }), 'props.members.0.links.0.url')).toMatch(/https/)
    expect(message(b8('team', { members: [{ ...member([]), name: '' }] }), 'props.members.0.name')).toBe('Enter a name.')
    expect(paths({ ...b8('team'), translations: { bn: { 'members.member-1.name': 'রিনা', 'members.member-1.role': 'x'.repeat(81) } } })).toEqual(['translations.bn.members.member-1.role'])
    const days = (b8('store_hours').props as { days: { open: string }[] }).days.map((d, i) => (i === 2 ? { ...d, open: '25:00' } : d))
    expect(message(b8('store_hours', { days }), 'props.days.2.open')).toBe('Enter a time such as 10:00.')
    expect(message(b8('progress_bars', { items: [{ id: 'i_a', label: 'Happy', value: 100.5 }] }), 'props.items.0.value')).toMatch(/0 to 100/)
  })

  it('chart: stacked kinds need 2 series and can’t be stacked from store numbers', () => {
    expect(message(b8('chart', { kind: 'stacked-column' }), 'props.series')).toMatch(/at least 2 series/)
    expect(message(b8('chart', { kind: 'stacked-column', data_source: 'store.products_per_category' }), 'props.kind')).toMatch(/can’t be stacked/)
    expect(paths(b8('chart', { data_source: 'store.rating_breakdown', source_product_id: UUID }))).toEqual([])
    expect(message(b8('chart', { data_source: 'store.products_per_category', source_product_id: UUID }), 'props.source_product_id')).toMatch(/all products/)
  })

  it('maps B8a paths to their form fields and shows them inline', () => {
    const node = b8('photo_grid')
    expect(formKey(node, 'sections.0.columns.0.elements.0.props.images.2.link.url')).toBe('images.2.link')
    expect(formKey(node, 'props.profile.url')).toBe('profile.url')
    expect(isInlineProblem(node, { path: 'props.images', message: 'x' }, false)).toBe(true)
    expect(needsSetup(b8('before_after'))).toBe(true)
    expect(needsSetup(b8('pricing_table'))).toBe(false)
  })
})
