import { cloneSample } from '@/storefront/builder/test-payload'
import type { BuilderContent, Element, RenderElement, Section } from '@/storefront/builder/types'
import type { StoreSection } from '@/storefront/types'
import { DATA_ELEMENT_TYPES, mediaIds, resolveInput, toRenderTree, withLocalTitles, wrappedElements } from './render-tree'
import { findNode, setHidden, setSchedule } from './tree'

const NOW = Date.parse('2026-11-11T12:00:00Z')

function element(sections: ReturnType<typeof toRenderTree>, id: string): RenderElement | undefined {
  for (const section of sections)
    for (const column of section.columns)
      for (const el of column.elements) {
        if (el.id === id) return el
        if ('columns' in el) for (const inner of el.columns) for (const e of inner.elements) if (e.id === id) return e
      }
  return undefined
}

describe('the canvas render tree', () => {
  it('resolves translations to the editor language and drops them', () => {
    const doc = cloneSample()
    const en = toRenderTree(doc, { locale: 'en', now: NOW })
    const bn = toRenderTree(doc, { locale: 'bn', now: NOW })
    expect((element(en, 'e_heading')!.props as { text: string }).text).toBe('Made fresh every morning')
    expect((element(bn, 'e_heading')!.props as { text: string }).text).toBe('প্রতিদিন সকালে তাজা তৈরি')
    expect('translations' in element(bn, 'e_heading')!).toBe(false)
  })

  it('leaves hidden nodes out except the selected one, marks scheduled ones', () => {
    let doc = setHidden(cloneSample(), 'e_text', true)
    doc = setSchedule(doc, 'e_button', { starts_at: '2026-12-01T00:00:00Z', ends_at: null })
    doc = setSchedule(doc, 'e_image', { starts_at: null, ends_at: '2026-11-01T00:00:00Z' })
    const tree = toRenderTree(doc, { locale: 'en', now: NOW })
    expect(element(tree, 'e_text')).toBeUndefined()
    expect(tree.find((s) => s.id === 's_hidden')).toBeUndefined()
    expect(element(tree, 'e_button')!.state).toBe('scheduled')
    expect(element(tree, 'e_image')!.state).toBe('expired')
    const revealed = toRenderTree(doc, { locale: 'en', now: NOW, reveal: 'e_text' })
    expect(element(revealed, 'e_text')!.state).toBe('hidden')
  })

  it('lists wrapped elements and media for /builder/resolve', () => {
    const doc = cloneSample()
    expect(wrappedElements(doc).map((e) => e.id)).toEqual(['e_slider', 'e_grid'])
    expect(resolveInput(findNode(doc, 'e_grid')!.node as Element)).toMatchObject({ id: 'e_grid', type: 'product_grid', items: [], translations: expect.any(Object) })
    expect(mediaIds(doc)).toContain('01a1c9d9-0000-7000-8000-000000000002')
  })

  it('shows a renamed wrapped section’s title before the next resolve', () => {
    const doc = cloneSample()
    const grid = findNode(doc, 'e_grid')!.node as Element
    const data = { id: 'e_grid', type: 'product_grid', title: 'Old', subtitle: 'Sub', config: {}, products: [] } as unknown as StoreSection
    const renamed = { ...grid, props: { ...grid.props, title: 'New title' } } as Element
    expect(withLocalTitles(data, renamed, 'en')).toMatchObject({ title: 'New title', subtitle: 'What everyone is buying' })
  })
})

describe('the canvas render tree: B4 elements', () => {
  const common = { style: {}, visibility: { desktop: true, tablet: true, mobile: true }, hidden: false, schedule: null }
  const withElements = (...elements: Element[]): BuilderContent => ({
    schema_version: 1,
    sections: [{ id: 's_b4', type: 'section', props: { layout: 'boxed', anchor: null }, ...common, translations: {}, columns: [{ id: 'c_b4', type: 'column', width: { base: 100 }, style: {}, elements }] } as Section],
  })

  it('resolves dot-key translations of nested labels; an absent second button stays absent', () => {
    const cta = {
      id: 'e_cta', type: 'cta', ...common,
      props: { title: 'Hi', text: '', primary: { label: 'Shop', link: { url: '/shop' } }, secondary: null, align: 'center' },
      translations: { bn: { title: 'হাই', 'primary.label': 'কিনুন', 'secondary.label': 'আরও' } },
    } as unknown as Element
    const tree = toRenderTree(withElements(cta), { locale: 'bn', now: NOW })
    expect(element(tree, 'e_cta')!.props).toMatchObject({ title: 'হাই', primary: { label: 'কিনুন', link: { url: '/shop' } }, secondary: null })
  })

  it('sends the B4 data elements to /builder/resolve with their props', () => {
    const menu = { id: 'e_menu', type: 'menu', ...common, props: { menu_id: 'm-1', layout: 'horizontal', show_children: 'dropdown' }, translations: {} } as unknown as Element
    const icon = { id: 'e_icon', type: 'icon', ...common, props: { name: 'star', size: 32, color: null, label: '', link: null }, translations: {} } as unknown as Element
    const faq = { id: 'e_faq', type: 'faq_list', ...common, props: { title: null, style: 'accordion' }, translations: { bn: { title: 'প্রশ্ন' } } } as unknown as Element
    const doc = withElements(menu, icon, faq)
    expect(wrappedElements(doc).map((e) => e.id)).toEqual(['e_menu', 'e_faq'])
    expect(resolveInput(faq)).toEqual({ id: 'e_faq', type: 'faq_list', props: { title: null, style: 'accordion' }, translations: { bn: { title: 'প্রশ্ন' } } })
    expect(DATA_ELEMENT_TYPES.has('contact_form')).toBe(true)
  })
})

describe('B6 in the canvas render tree', () => {
  const common = { style: {}, visibility: { desktop: true, tablet: true, mobile: true }, hidden: false, schedule: null }
  const UUID = '0b6f2e3c-1a2b-4c3d-8e9f-0123456789ab'
  const UUID2 = '1b6f2e3c-1a2b-4c3d-8e9f-0123456789ab'
  const UUID3 = '2b6f2e3c-1a2b-4c3d-8e9f-0123456789ab'
  const doc = (elements: Element[], style: Section['style'] = {}): BuilderContent => ({
    schema_version: 1,
    sections: [{ id: 's_b6', type: 'section', props: { layout: 'boxed', anchor: null }, ...common, style, translations: {}, columns: [{ id: 'c_b6', type: 'column', width: { base: 100 }, style: {}, elements }] }],
  })

  it('applies item, label and series translations by id and position', () => {
    const accordion = {
      id: 'e_acc', type: 'accordion', ...common,
      props: { items: [{ id: 'i_a', title: 'Fresh?', html: '<p>Yes</p>' }, { id: 'i_b', title: 'Cash?', html: '' }], open_first: true, allow_multiple: false, style: 'boxed' },
      translations: { bn: { 'items.i_b.title': 'নগদ?', 'items.i_x.title': 'ignored', 'items.i_a.secret': 'ignored' } },
    } as unknown as Element
    const chart = {
      id: 'e_chart', type: 'chart', ...common,
      props: { kind: 'column', title: 'Sales', description: '', labels: ['Jan', 'Feb'], series: [{ id: 'series-1', name: 'Online', values: [1, 2] }], unit: '', unit_position: 'after', y_starts_at_zero: true, show_values: 'none', show_legend: true, show_table: false, height: 320 },
      translations: { bn: { title: 'বিক্রি', 'labels.1': 'ফেব্রু', 'series.series-1.name': 'অনলাইন' } },
    } as unknown as Element
    const bn = toRenderTree(doc([accordion, chart]), { locale: 'bn', now: NOW })
    expect((element(bn, 'e_acc')!.props as { items: { title: string }[] }).items.map((i) => i.title)).toEqual(['Fresh?', 'নগদ?'])
    expect(element(bn, 'e_acc')!.props).not.toHaveProperty('items.0.secret')
    expect(element(bn, 'e_chart')!.props).toMatchObject({ title: 'বিক্রি', labels: ['Jan', 'ফেব্রু'], series: [{ name: 'অনলাইন' }] })
  })

  it('category card, product spotlight and shop the look are resolved by the server; moving a hotspot keeps the key', () => {
    expect(['category_card', 'product_spotlight', 'shop_the_look'].every((t) => DATA_ELEMENT_TYPES.has(t))).toBe(true)
    const look = { id: 'e_look', type: 'shop_the_look', ...common, translations: {}, props: { media_id: UUID, alt: '', title: '', hotspots: [{ id: 'h_a', x: 10, y: 10, product_id: UUID2 }] } } as unknown as Element
    expect(wrappedElements(doc([look])).map((e) => e.id)).toEqual(['e_look'])
    expect(resolveInput(look)).toMatchObject({ id: 'e_look', type: 'shop_the_look', props: { media_id: UUID } })
  })

  it('collects media ids of gallery, carousels, logos, category card, shop the look and background video posters', () => {
    const gallery = { id: 'e_gal', type: 'gallery', ...common, translations: {}, props: { images: [{ id: 'i_a', media_id: UUID, alt: '', caption: '' }], columns: { base: 3 }, aspect: 'square', lightbox: true, gap: 'md' } } as unknown as Element
    const logos = { id: 'e_logo', type: 'logo_carousel', ...common, translations: {}, props: { logos: [{ id: 'i_l', media_id: UUID2, alt: '', link: null }], grayscale: true, speed: 'normal' } } as unknown as Element
    const card = { id: 'e_card', type: 'category_card', ...common, translations: {}, props: { category_id: UUID, media_id: UUID3, title: null, button_label: 'Shop', layout: 'overlay' } } as unknown as Element
    const style = { base: { background: { type: 'none', video: { url: 'https://youtu.be/dQw4w9WgXcQ', provider: 'youtube', video_id: 'dQw4w9WgXcQ', poster: { media_id: 'ffffffff-1a2b-4c3d-8e9f-0123456789ab' } } } } } as Section['style']
    expect(mediaIds(doc([gallery, logos, card], style)).sort()).toEqual([UUID, UUID2, UUID3, 'ffffffff-1a2b-4c3d-8e9f-0123456789ab'].sort())
  })
})

describe('B6 resolve keys', () => {
  it('a shop the look is re-resolved only when its photo or products change', async () => {
    const { resolveKey } = await import('./render-tree')
    const common = { style: {}, visibility: { desktop: true, tablet: true, mobile: true }, hidden: false, schedule: null, translations: {} }
    const look = (x: number, product: string) =>
      ({ id: 'e_look', type: 'shop_the_look', ...common, props: { media_id: 'm', alt: '', title: '', hotspots: [{ id: 'h_a', x, y: 10, product_id: product }] } }) as unknown as Element
    expect(resolveKey(look(10, 'p1'))).toBe(resolveKey(look(55, 'p1')))
    expect(resolveKey(look(10, 'p1'))).not.toBe(resolveKey(look(10, 'p2')))
  })
})
