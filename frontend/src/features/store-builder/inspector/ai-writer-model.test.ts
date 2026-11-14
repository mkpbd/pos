import { describe, expect, it } from 'vitest'
import type { Element, Section } from '@/storefront/builder/types'
import { applyProposals, currentTexts, elementTextEntries, entriesFor, hasWritableText, nodeIn, proposals, SECTION_FIELD_LIMIT, sectionTextEntries } from './ai-writer-model'

const common = { style: {}, visibility: { desktop: true, tablet: true, mobile: true }, hidden: false, schedule: null, translations: {} }
const el = (id: string, type: string, props: Record<string, unknown>, translations: Record<string, Record<string, string>> = {}) => ({ id, type, props, ...common, translations }) as unknown as Element
const section = (elements: Element[]): Section =>
  ({ id: 's_sec001', type: 'section', props: { layout: 'boxed', anchor: null }, ...common, columns: [{ id: 'c_col001', type: 'column', width: { base: 100 }, style: {}, elements }] }) as unknown as Section

const heading = el('e_head01', 'heading', { text: 'Hello', level: 2, link: null })
const cta = el('e_cta001', 'cta', { title: 'Ready', text: '', primary: { label: 'Shop now', link: { url: '/shop' } }, secondary: null, align: 'center' })
const accordion = el('e_acc001', 'accordion', { items: [{ id: 'i_one', title: 'Q1', html: '<p>A1</p>' }, { id: 'i_two', title: 'Q2', html: '<p>A2</p>' }], open_first: true, allow_multiple: false, style: 'boxed' })
const chart = el('e_chart1', 'chart', { kind: 'column', title: 'Sales', description: '', labels: ['Jan', 'Feb'], series: [{ id: 's_a', name: 'Shop', values: [1, 2] }], unit: '' })

describe('AI writer texts', () => {
  it('lists an element’s translatable texts by their stored keys, with plain labels', () => {
    expect(elementTextEntries(heading).map((e) => [e.key, e.value, e.label])).toEqual([['text', 'Hello', 'Text']])
    // A missing second button has no text to write.
    expect(elementTextEntries(cta).map((e) => e.key)).toEqual(['title', 'text', 'primary.label'])
    expect(elementTextEntries(accordion).map((e) => [e.key, e.html, e.label])).toEqual([
      ['items.i_one.title', false, 'Item 1: title'],
      ['items.i_two.title', false, 'Item 2: title'],
      ['items.i_one.html', true, 'Item 1: text'],
      ['items.i_two.html', true, 'Item 2: text'],
    ])
    expect(elementTextEntries(chart).map((e) => e.key)).toEqual(['title', 'description', 'labels.0', 'labels.1', 'series.s_a.name'])
    expect(elementTextEntries(el('e_spc001', 'spacer', {}))).toEqual([])
    // Never written: custom HTML, a map's place.
    expect(elementTextEntries(el('e_html01', 'custom_html', { html: '<p>x</p>' }))).toEqual([])
    expect(elementTextEntries(el('e_map001', 'map', { query: 'Dhanmondi 27', title: 'Find us', zoom: 14, height: 360 })).map((e) => e.key)).toEqual(['title'])
  })

  it('collects a section’s texts (inner rows included), at most 40 per request', () => {
    const inner = { id: 'e_row001', type: 'inner_row', props: {}, ...common, columns: [{ id: 'c_in0001', type: 'column', width: { base: 100 }, style: {}, elements: [heading] }] } as unknown as Element
    const s = section([cta, inner])
    expect(sectionTextEntries(s).map((e) => `${e.nodeId}:${e.key}`)).toEqual(['e_cta001:title', 'e_cta001:text', 'e_cta001:primary.label', 'e_head01:text'])
    expect(hasWritableText(s)).toBe(true)
    expect(hasWritableText(section([]))).toBe(false)
    expect(nodeIn(s, 'e_head01')).toBe(heading)
    const many = section(Array.from({ length: 45 }, (_, i) => el(`e_h${String(i).padStart(5, '0')}`, 'heading', { text: `H${i}`, level: 2, link: null })))
    expect(entriesFor(many)).toHaveLength(SECTION_FIELD_LIMIT)
  })

  it('builds the request’s current texts per element or per section', () => {
    expect(currentTexts(elementTextEntries(heading), 'element')).toEqual({ text: 'Hello' })
    expect(currentTexts(sectionTextEntries(section([heading, cta])), 'section')).toEqual({
      e_head01: { text: 'Hello' },
      e_cta001: { title: 'Ready', text: '', 'primary.label': 'Shop now' },
    })
  })

  it('applies chosen texts to base props in one new node; unknown keys are ignored, plain texts cut to the limit', () => {
    const entries = elementTextEntries(accordion)
    const answer = { texts: { 'items.i_two.title': 'New Q2', 'items.i_one.html': '<p>New A1</p>', 'items.zzz.title': 'ignored', 'items.i_one.title': 'x'.repeat(500) }, elements: {} }
    const items = proposals(entries, answer, 'element', 'base', () => accordion)
    expect(items.map((p) => [p.entry.key, p.before])).toEqual([
      ['items.i_one.title', 'Q1'],
      ['items.i_two.title', 'Q2'],
      ['items.i_one.html', '<p>A1</p>'],
    ])
    expect(items[0]!.after).toHaveLength(120)
    const next = applyProposals(accordion, items.slice(1), 'base') as Element & { props: { items: { title: string; html: string }[] } }
    expect(next.id).toBe(accordion.id)
    expect(next.props.items).toEqual([
      { id: 'i_one', title: 'Q1', html: '<p>New A1</p>' },
      { id: 'i_two', title: 'New Q2', html: '<p>A2</p>' },
    ])
    expect(accordion.props).toMatchObject({ items: [{ title: 'Q1' }, { title: 'Q2' }] })
  })

  it('writes nested and indexed keys (button label, chart label)', () => {
    const p1 = proposals(elementTextEntries(cta), { texts: { 'primary.label': 'Buy today' }, elements: {} }, 'element', 'base', () => cta)
    expect((applyProposals(cta, p1, 'base') as Element & { props: { primary: { label: string; link: unknown } } }).props.primary).toEqual({ label: 'Buy today', link: { url: '/shop' } })
    const p2 = proposals(elementTextEntries(chart), { texts: { 'labels.1': 'February' }, elements: {} }, 'element', 'base', () => chart)
    expect((applyProposals(chart, p2, 'base') as Element & { props: { labels: string[] } }).props.labels).toEqual(['Jan', 'February'])
  })

  it('writes Bangla into translations.bn under the same keys, keeping other translations', () => {
    const translated = el('e_head01', 'heading', { text: 'Hello', level: 2, link: null }, { bn: { other: 'x' } })
    const items = proposals(elementTextEntries(translated), { texts: { text: 'হ্যালো' }, elements: {} }, 'element', 'bn', () => translated)
    expect(items[0]!.before).toBe('')
    const next = applyProposals(translated, items, 'bn') as Element
    expect(next.translations).toEqual({ bn: { other: 'x', text: 'হ্যালো' } })
    expect((next as unknown as { props: { text: string } }).props.text).toBe('Hello')
  })

  it('applies a section answer (per element) as one changed section', () => {
    const s = section([heading, cta])
    const entries = sectionTextEntries(s)
    const answer = { texts: {}, elements: { e_head01: { text: 'Eid sale' }, e_cta001: { title: 'Shop the sale' } } }
    const next = applyProposals(s, proposals(entries, answer, 'section', 'base', (id) => nodeIn(s, id)), 'base') as Section
    expect(next.id).toBe('s_sec001')
    const [h, c] = next.columns[0]!.elements as unknown as { props: Record<string, unknown> }[]
    expect(h!.props.text).toBe('Eid sale')
    expect(c!.props.title).toBe('Shop the sale')
    expect(c!.props.text).toBe('')
  })
})
