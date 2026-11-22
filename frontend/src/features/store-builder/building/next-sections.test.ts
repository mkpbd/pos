import { cloneSample } from '@/storefront/builder/test-payload'
import type { Column, Element, Section } from '@/storefront/builder/types'
import { pageTypeOf, ROLE_TEMPLATES, sectionRole, suggestNextSections } from './next-sections'

/* B21 "What next?": the rule engine (page type from key / title words, section roles, no repeated single-use sections). */

const VIS = { desktop: true, tablet: true, mobile: true }
const el = (id: string, type: string, props: Record<string, unknown> = {}) => ({ id, type, props, style: {}, visibility: VIS, hidden: false, schedule: null, translations: {} }) as unknown as Element
const sec = (id: string, elements: Element[], props: Record<string, unknown> = {}): Section =>
  ({ id, type: 'section', props: { layout: 'boxed', anchor: null, ...props }, style: {}, visibility: VIS, hidden: false, schedule: null, translations: {}, columns: [{ id: `c_${id}`, type: 'column', width: { base: 100 }, style: {}, elements } as Column] }) as Section

const hero = () => sec('s_hero', [el('e_slider', 'hero_slider')])
const products = () => sec('s_products', [el('e_grid', 'product_grid')])
const reviews = () => sec('s_reviews', [el('e_wall', 'review_wall')])
const faq = () => sec('s_faq', [el('e_faq', 'faq_list')])
const ALL = new Set(Object.values(ROLE_TEMPLATES).flat())
const roles = (list: { role: string }[]) => list.map((s) => s.role)

describe('next sections (B21 What next?)', () => {
  it('a global section reference (no props or columns of its own) never breaks the suggestions', () => {
    const globalRef = { id: 'g1', type: 'global_section', ref: 'global:footer-promo', hidden: false, schedule: null } as unknown as Section
    expect(sectionRole(globalRef, 0)).toBeNull()
    const sections = [globalRef, ...cloneSample().sections]
    expect(() => suggestNextSections({ document: { key: 'landing:sale', title: 'Sale' }, sections })).not.toThrow()
    expect(() => suggestNextSections({ document: { key: 'landing:sale', title: 'Sale' }, sections, afterId: 'g1' })).not.toThrow()
  })

  it('tells the page type from the key and the title (English and Bangla)', () => {
    expect(pageTypeOf({ key: 'home', title: 'Home' })).toBe('home')
    expect(pageTypeOf({ key: 'landing:winter-sale', title: 'Winter' })).toBe('sale')
    expect(pageTypeOf({ key: 'landing:x', title: 'ঈদ অফার' })).toBe('festival')
    expect(pageTypeOf({ key: 'landing:new-collection', title: 'Autumn' })).toBe('launch')
    expect(pageTypeOf({ key: 'cms:1', title: 'About us' })).toBe('about')
    expect(pageTypeOf({ key: 'cms:2', title: 'যোগাযোগ' })).toBe('contact')
    expect(pageTypeOf({ key: 'landing:honey', title: 'Honey' })).toBe('page')
  })

  it('reads a section role from its template id first, else from what is inside', () => {
    expect(sectionRole(sec('s_a', [el('e_t', 'text')], { source_template: 'neutral-faq-accordion' }), 3)).toBe('faq')
    expect(sectionRole(hero(), 0)).toBe('hero')
    expect(sectionRole(products(), 1)).toBe('products')
    expect(sectionRole(sec('s_b', [el('e_h', 'heading'), el('e_b', 'button'), el('e_i', 'image')]), 0)).toBe('hero')
    expect(sectionRole(sec('s_b', [el('e_h', 'heading'), el('e_i', 'image')]), 2)).toBe('story')
    expect(sectionRole(sec('s_c', [el('e_s', 'spacer')]), 2)).toBeNull()
    // Hidden elements do not count.
    expect(sectionRole(sec('s_d', [{ ...el('e_g', 'product_grid'), hidden: true } as Element]), 2)).toBeNull()
  })

  it('an empty page starts with its type’s first sections', () => {
    expect(roles(suggestNextSections({ document: { key: 'home', title: 'Home' }, sections: [] }))).toEqual(['hero', 'products', 'trust'])
    expect(roles(suggestNextSections({ document: { key: 'landing:sale', title: 'Big sale' }, sections: [] }))).toEqual(['hero', 'countdown', 'products'])
    expect(roles(suggestNextSections({ document: { key: 'cms:9', title: 'About us' }, sections: [] }))).toEqual(['story', 'testimonials', 'contact'])
  })

  it('after a hero: products, trust badges, and a countdown on sale pages', () => {
    expect(roles(suggestNextSections({ document: { key: 'home', title: 'Home' }, sections: [hero()] }))).toEqual(['products', 'trust', 'categories'])
    expect(roles(suggestNextSections({ document: { key: 'landing:eid', title: 'Eid sale' }, sections: [hero()] }))).toEqual(['countdown', 'products', 'trust'])
  })

  it('after products: reviews, questions and a call to action', () => {
    expect(roles(suggestNextSections({ document: { key: 'home', title: 'Home' }, sections: [hero(), products()] }))).toEqual(['testimonials', 'faq', 'cta'])
  })

  it('never repeats a single-use section and never suggests a second hero', () => {
    const list = suggestNextSections({ document: { key: 'home', title: 'Home' }, sections: [hero(), products(), reviews(), faq()] })
    expect(roles(list)).not.toContain('testimonials')
    expect(roles(list)).not.toContain('faq')
    expect(roles(list)).not.toContain('hero')
    expect(list).toHaveLength(3)
    expect(new Set(list.map((s) => s.templateId)).size).toBe(3)
  })

  it('follows the selected section when one is given', () => {
    const sections = [hero(), products(), faq()]
    expect(roles(suggestNextSections({ document: { key: 'home', title: 'Home' }, sections, afterId: 's_hero' }))).toEqual(['products', 'trust', 'categories'])
    expect(roles(suggestNextSections({ document: { key: 'home', title: 'Home' }, sections }))).toEqual(['cta', 'contact', 'newsletter'])
  })

  it('only suggests templates this store can insert', () => {
    const available = new Set(['neutral-faq-teaser', 'neutral-cta-band'])
    const list = suggestNextSections({ document: { key: 'home', title: 'Home' }, sections: [hero(), products()], available })
    expect(list.map((s) => s.templateId)).toEqual(['neutral-faq-teaser', 'neutral-cta-band'])
    expect(suggestNextSections({ document: { key: 'home', title: 'Home' }, sections: [], available: new Set() })).toEqual([])
  })

  it('works on the shared sample page', () => {
    const sample = cloneSample()
    const list = suggestNextSections({ document: { key: 'home', title: 'Home' }, sections: sample.sections, available: ALL })
    expect(list).toHaveLength(3)
    for (const suggestion of list) expect(suggestion.label).not.toBe('')
  })
})
