import { cloneSample } from '@/storefront/builder/test-payload'
import b6 from '@/storefront/builder/__fixtures__/sample-b6-elements.v1.json'
import b8a from '@/storefront/builder/__fixtures__/sample-b8a-elements.v1.json'
import type { BuilderContent, Column, Element, Section } from '@/storefront/builder/types'
import { applyLayoutToContent, applyLayoutVariant, hasLayoutVariants, layoutVariants, nextVariant } from './layout-variants'

/*
 * B21 "Try another layout": every variant only rearranges. The proof: for each common section
 * shape, every variant — and every variant after that (a round trip) — keeps every element id and
 * every text, picture, link, product and icon value exactly where it was in that element.
 */

const VIS = { desktop: true, tablet: true, mobile: true }
const el = (id: string, type: string, props: Record<string, unknown>, extra: Partial<Element> = {}) =>
  ({ id, type, props, style: {}, visibility: VIS, hidden: false, schedule: null, translations: {}, ...extra }) as unknown as Element
const col = (id: string, elements: Element[], base = 100): Column => ({ id, type: 'column', width: { base }, style: {}, elements })
const sec = (id: string, columns: Column[], style: Section['style'] = {}): Section =>
  ({ id, type: 'section', props: { layout: 'boxed', anchor: null }, style, visibility: VIS, hidden: false, schedule: null, translations: {}, columns }) as Section

const PICTURE = '01a1c9d9-0000-7000-8000-00000000aa01'

const mediaText = () =>
  sec('s_media', [
    col('c_pic', [el('e_pic', 'image', { media_id: PICTURE, alt: 'Fresh honey jars', link: null, aspect: '4:3', fit: 'cover' })], 50),
    col('c_words', [
      el('e_h', 'heading', { text: 'Pure Sundarban honey', level: 2, link: null }, { translations: { bn: { text: 'খাঁটি সুন্দরবনের মধু' } } }),
      el('e_t', 'text', { html: '<p>Straight from the hives.</p>' }),
      el('e_b', 'button', { label: 'Order now', link: { url: '/p/honey' }, variant: 'primary', size: 'md', full_width: false }),
      el('e_sp', 'spacer', {}),
    ], 50),
  ])

const cards = () =>
  sec(
    's_cards',
    ['truck', 'shield', 'phone', 'gift'].map((icon, i) =>
      col(`c_card${i}`, [el(`e_box${i}`, 'icon_box', { icon, title: `Promise ${i}`, text: `We keep promise ${i}.`, link: null, layout: 'top', icon_style: 'circle' })], 25),
    ),
  )

const single = (id: string, element: Element) => sec(id, [col(`c_${id}`, [element])])
const find = <T,>(sections: { id: string }[], id: string) => structuredClone(sections.find((s) => s.id === id)) as T
const b6Element = (id: string) => (find<Section>(b6.sections, 's_b6').columns[0]!.elements.find((e) => e.id === id) as Element)
const b8aElement = (id: string) => (find<Section>(b8a.sections, 's_b8a').columns[0]!.elements.find((e) => e.id === id) as Element)

const sample = cloneSample()
const SHAPES: [string, () => Section][] = [
  ['media + text (no background)', mediaText],
  ['media + text (sample story, gradient)', () => structuredClone(sample.sections.find((s) => s.id === 's_story')!)],
  ['a row of four cards', cards],
  ['cards in an inner row (sample features)', () => structuredClone(sample.sections.find((s) => s.id === 's_features')!)],
  ['a product grid (sample)', () => structuredClone(sample.sections.find((s) => s.id === 's_products')!)],
  ['a gallery', () => single('s_gallery', b6Element('e_gallery'))],
  ['an icon list', () => single('s_icons', b6Element('e_icon_list'))],
  ['steps', () => single('s_steps', b6Element('e_steps'))],
  ['team', () => single('s_team', b8aElement('e_team'))],
  ['a review wall', () => single('s_reviews', b8aElement('e_reviews'))],
  ['photo grid', () => single('s_photos', b8aElement('e_photos'))],
  ['plain text', () => sec('s_text', [col('c_text', [el('e_th', 'heading', { text: 'Our promise', level: 2, link: null }), el('e_tt', 'text', { html: '<p>Fresh, every day.</p>' })])])],
]

/** Arrangement words, not content. */
const ARRANGEMENT_KEYS = new Set(['layout', 'align'])

/** Every element id with every text / picture / link / product / icon value it holds (props and translations). */
function contentOf(section: Section): string[] {
  const out: string[] = []
  const leaves = (owner: string, path: string, value: unknown) => {
    if (typeof value === 'string' || typeof value === 'number') {
      const key = path.split('.').at(-1)!
      if (!ARRANGEMENT_KEYS.has(key) && !(path.includes('columns') && typeof value === 'number') && !path.includes('config.columns')) out.push(`${owner}|${path}=${value}`)
      return
    }
    if (Array.isArray(value)) return value.forEach((v, i) => leaves(owner, `${path}.${i}`, v))
    if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) leaves(owner, path ? `${path}.${k}` : k, v)
  }
  const visit = (columns: Column[]) => {
    for (const column of columns) {
      for (const element of column.elements) {
        out.push(`id:${element.id}`)
        leaves(element.id, 'props', element.props)
        leaves(element.id, 'translations', element.translations)
        if (element.type === 'inner_row') visit((element as unknown as { columns: Column[] }).columns)
      }
    }
  }
  visit(section.columns)
  return out.sort()
}

describe('layout variants (B21 Try another layout)', () => {
  it.each(SHAPES)('%s: offers 2–6 arrangements and marks the current one', (_, make) => {
    const variants = layoutVariants(make())
    expect(variants.length).toBeGreaterThanOrEqual(2)
    expect(variants.length).toBeLessThanOrEqual(6)
    expect(variants.filter((v) => v.current).length).toBeLessThanOrEqual(2)
    expect(new Set(variants.map((v) => v.id)).size).toBe(variants.length)
  })

  it.each(SHAPES)('%s: no text, picture, link or product is lost by any variant or any round trip', (_, make) => {
    const original = make()
    const before = contentOf(original)
    const existing = new Set<string>()
    for (const first of layoutVariants(original)) {
      const once = applyLayoutVariant(original, first.id, existing)
      expect(contentOf(once)).toEqual(before)
      // The variant applied is the one shown as current afterwards.
      expect(layoutVariants(once).find((v) => v.id === first.id)?.current).toBe(true)
      for (const second of layoutVariants(once)) {
        const twice = applyLayoutVariant(once, second.id, existing)
        expect(contentOf(twice)).toEqual(before)
        for (const third of layoutVariants(twice)) expect(contentOf(applyLayoutVariant(twice, third.id, existing))).toEqual(before)
      }
    }
  })

  it('media + text: picture left / right / above / behind; behind keeps the picture (hidden) and comes back', () => {
    const section = mediaText()
    expect(layoutVariants(section).map((v) => v.id)).toEqual(['media-left', 'media-right', 'media-top', 'media-behind', 'align-left', 'align-center'])
    const right = applyLayoutVariant(section, 'media-right')
    expect(right.columns.map((c) => c.id)).toEqual(['c_words', 'c_pic'])
    const top = applyLayoutVariant(right, 'media-top')
    expect(top.columns.map((c) => [c.id, c.width.base])).toEqual([['c_pic', 100], ['c_words', 100]])
    const behind = applyLayoutVariant(top, 'media-behind')
    expect(behind.columns).toHaveLength(1)
    expect(behind.style.base?.background).toMatchObject({ type: 'image', image: { media_id: PICTURE } })
    const hidden = behind.columns[0]!.elements[0]!
    expect([hidden.id, hidden.hidden]).toEqual(['e_pic', true])
    const back = applyLayoutVariant(behind, 'media-left', new Set(['c_x']))
    expect(back.style.base?.background).toBeUndefined()
    expect(back.style.base?.color).toBeUndefined()
    expect(back.columns[0]!.elements.map((e) => [e.id, e.hidden])).toEqual([['e_pic', false]])
    expect(back.columns[1]!.id).toBe('c_words')
  })

  it('media + text with a background of its own: no "behind" (its background would be lost)', () => {
    const story = structuredClone(sample.sections.find((s) => s.id === 's_story')!)
    expect(layoutVariants(story).map((v) => v.id)).not.toContain('media-behind')
  })

  it('cards: per row and a list change only the widths (column ids stay)', () => {
    const section = cards()
    expect(layoutVariants(section).map((v) => v.id)).toEqual(['cols-2', 'cols-3', 'cols-4', 'cols-list', 'align-left', 'align-center'])
    expect(layoutVariants(section).find((v) => v.current)?.id).toBe('cols-4')
    const two = applyLayoutVariant(section, 'cols-2')
    expect(two.columns.map((c) => c.width)).toEqual(Array(4).fill({ base: 50, tablet: 50, mobile: 100 }))
    const list = applyLayoutVariant(two, 'cols-list')
    expect(list.columns.map((c) => [c.id, c.width.base])).toEqual(section.columns.map((c) => [c.id, 100]))
  })

  it('products: grid 3 / 4 / 5 and a sliding row keep the title, source and items', () => {
    const section = structuredClone(sample.sections.find((s) => s.id === 's_products')!)
    const grid = section.columns[0]!.elements[0]!
    const carousel = applyLayoutVariant(section, 'products-carousel').columns[0]!.elements[0]!
    expect(carousel.type).toBe('product_carousel')
    expect(carousel.id).toBe(grid.id)
    expect((carousel.props as unknown as { config: Record<string, unknown> }).config).not.toHaveProperty('columns')
    const five = applyLayoutVariant(applyLayoutVariant(section, 'products-carousel'), 'products-grid-5').columns[0]!.elements[0]!
    expect(five.type).toBe('product_grid')
    expect((five.props as unknown as { config: { columns: number } }).config.columns).toBe(5)
    expect((five.props as unknown as { title: unknown }).title).toEqual((grid.props as unknown as { title: unknown }).title)
  })

  it('a global section reference has nothing to rearrange', () => {
    const globalRef = { id: 'g1', type: 'global_section', ref: 'global:promo', hidden: false, schedule: null } as unknown as Section
    expect(layoutVariants(globalRef)).toEqual([])
  })

  it('applies to the draft as one change and leaves other sections alone', () => {
    const content = { schema_version: 1, sections: [mediaText(), cards()] } as BuilderContent
    const next = applyLayoutToContent(content, 's_media', 'media-right')
    expect(next.sections[1]).toBe(content.sections[1])
    expect(next.sections[0]!.columns[0]!.id).toBe('c_words')
    expect(applyLayoutToContent(content, 's_nope', 'media-right')).toBe(content)
  })

  it('Shuffle steps through the arrangements, skipping the current one', () => {
    const variants = layoutVariants(cards())
    expect(nextVariant(variants)?.id).toBe('cols-list')
    expect(nextVariant(variants, 'cols-list')?.id).toBe('align-center')
    expect(nextVariant(variants, 'align-center')?.id).toBe('cols-2')
    expect(nextVariant([])).toBeNull()
  })

  it('a section with nothing to rearrange offers nothing', () => {
    expect(hasLayoutVariants(sec('s_empty', [col('c_e', [])]))).toBe(false)
    expect(hasLayoutVariants(single('s_sp', el('e_sp', 'spacer', {})))).toBe(false)
  })
})
