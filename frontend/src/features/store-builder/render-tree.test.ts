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
