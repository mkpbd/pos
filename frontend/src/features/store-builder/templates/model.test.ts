import { BUILDER_LIMITS } from '@/storefront/builder/registry'
import { cloneSample } from '@/storefront/builder/test-payload'
import type { BuilderContent, Section } from '@/storefront/builder/types'
import { checkDocument } from '../check'
import { collectIds } from '../tree'
import type { BuilderTemplate } from './api'
import { categoryLabel, filterTemplates, insertionIndex, insertSections, prepareSections, templateCategories, usableIn } from './model'
import { insertedMessage } from './use-insert-template'

const template = (over: Partial<BuilderTemplate>): BuilderTemplate => ({
  id: 't', scope: 'section', preset: null, category: 'hero', name: 'Template', description: null, thumbnail_url: null, allowed_in: ['page', 'cms', 'zone'], source: 'builtin', ...over,
})

const LIBRARY: BuilderTemplate[] = [
  template({ id: 'vegan-hero', preset: 'vegan', category: 'hero', name: 'Fresh hero', description: 'A big banner with a call to action' }),
  template({ id: 'classic-grid', preset: 'classic', category: 'products', name: 'Best sellers row' }),
  template({ id: 'cta-band', category: 'cta', name: 'Call-to-action band' }),
  template({ id: 'header-bar', category: 'header', name: 'Logo and menu', allowed_in: ['header'] }),
  template({ id: 'about-page', scope: 'page', category: 'pages', name: 'About us', allowed_in: ['page', 'cms'] }),
  template({ id: 'site-vegan', scope: 'site', preset: 'vegan', category: null, name: 'Vegan Market', allowed_in: ['page'] }),
  template({ id: 'mine-1', source: 'mine', category: 'promo', name: 'Eid offer banner', allowed_in: ['page'] }),
]

const section = (id: string, anchor: string | null = null, elementId = 'e_1'): Section => ({
  id, type: 'section', props: { layout: 'boxed', anchor }, style: {}, visibility: { desktop: true, tablet: true, mobile: true }, hidden: false, schedule: null, translations: {},
  columns: [{ id: `c_${id}`, type: 'column', width: { base: 100 }, style: {}, elements: [{ id: elementId, type: 'heading', props: { text: 'Hello', level: 2, link: null }, style: {}, visibility: { desktop: true, tablet: true, mobile: true }, hidden: false, schedule: null, translations: {} } as never] }],
})

describe('templates model', () => {
  it('keeps the section and page templates allowed in the context (never site templates)', () => {
    expect(usableIn(LIBRARY, 'page').map((t) => t.id)).toEqual(['vegan-hero', 'classic-grid', 'cta-band', 'about-page', 'mine-1'])
    expect(usableIn(LIBRARY, 'header').map((t) => t.id)).toEqual(['header-bar'])
    expect(usableIn(LIBRARY, 'zone').map((t) => t.id)).toEqual(['vegan-hero', 'classic-grid', 'cta-band'])
  })

  it('filters by look, mine, category and words', () => {
    const page = usableIn(LIBRARY, 'page')
    const base = { filter: 'all' as const, preset: null, category: null, search: '' }
    expect(filterTemplates(page, { ...base, filter: 'look', preset: 'vegan' }).map((t) => t.id)).toEqual(['vegan-hero'])
    expect(filterTemplates(page, { ...base, filter: 'look', preset: null })).toEqual([])
    expect(filterTemplates(page, { ...base, filter: 'mine' }).map((t) => t.id)).toEqual(['mine-1'])
    expect(filterTemplates(page, { ...base, category: 'cta' }).map((t) => t.id)).toEqual(['cta-band'])
    expect(filterTemplates(page, { ...base, search: 'CALL TO' }).map((t) => t.id)).toEqual(['vegan-hero'])
    expect(filterTemplates(page, { ...base, search: 'eid' }).map((t) => t.id)).toEqual(['mine-1'])
  })

  it('lists categories by their label', () => {
    expect(templateCategories(usableIn(LIBRARY, 'page'))).toEqual(['cta', 'hero', 'products', 'promo', 'pages'])
    expect(categoryLabel('feature-strip')).toBe('Feature strip')
    expect(categoryLabel('cta')).toBe('Call to action')
  })

  it('inserts after the selection’s section, else at the end', () => {
    const content = cloneSample()
    const second = content.sections[1]!
    const element = second.columns[0]!.elements[0]!
    expect(insertionIndex(content, null)).toBe(content.sections.length)
    expect(insertionIndex(content, element.id)).toBe(2)
    expect(insertionIndex(content, second.id)).toBe(2)
  })

  it('keeps fresh ids, renames colliding ones and clears only colliding anchors', () => {
    const content: BuilderContent = { schema_version: 1, sections: [section('s_a', 'offers')] }
    const prepared = prepareSections([section('s_a', 'offers'), section('s_new', 'story', 'e_2')], content)
    const ids = [...collectIds({ schema_version: 1, sections: prepared })]
    expect(prepared[0]!.id).not.toBe('s_a')
    expect(prepared[0]!.id).toMatch(/^s_[a-z0-9]{6}$/)
    expect(prepared[0]!.columns[0]!.id).not.toBe('c_s_a')
    expect(prepared[0]!.columns[0]!.elements[0]!.id).not.toBe('e_1')
    expect(prepared[0]!.props.anchor).toBeNull()
    expect(prepared[1]!.id).toBe('s_new')
    expect(prepared[1]!.props.anchor).toBe('story')
    expect(prepared[1]!.columns[0]!.elements[0]!.id).toBe('e_2')
    const all = [...collectIds(content), ...ids]
    expect(new Set(all).size).toBe(all.length)
    const next = insertSections(content, prepared, 1)
    expect(next.sections.map((s) => s.id)).toEqual(['s_a', prepared[0]!.id, 's_new'])
    expect(checkDocument(next)).toEqual([])
  })

  it('refuses an insert that would go over the section limit', () => {
    const full: BuilderContent = { schema_version: 1, sections: Array.from({ length: BUILDER_LIMITS.sections }, (_, i) => section(`s_${i}`, null, `e_${i}`)) }
    const extra = prepareSections([section('s_x')], full)
    expect(insertSections(full, extra, 0)).toBe(full)
    expect(insertSections(full, [], 0)).toBe(full)
  })

  it('says what an insert added to the media library', () => {
    expect(insertedMessage('Fresh hero', {})).toBe('“Fresh hero” added.')
    expect(insertedMessage('Fresh hero', { imported: { media: 3, banners: 1, banners_reused: 0 } })).toBe('“Fresh hero” added. 3 images were added to your media library and 1 banner was created.')
    expect(insertedMessage('Fresh hero', { imported: { media: 1 } })).toBe('“Fresh hero” added. 1 image was added to your media library.')
  })
})
