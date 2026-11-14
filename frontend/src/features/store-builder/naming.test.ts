import { cloneSample } from '@/storefront/builder/test-payload'
import type { Section } from '@/storefront/builder/types'
import { containsCustomHtml, nodeName, nodeSummary } from './commands'
import { allowedIn, elementContext, isProductZone, kindInfo, parseZoneKey, targetedZoneKey } from './document-kind'
import { flattenLayers } from './layers'
import { findNode } from './tree'

describe('layer and canvas names', () => {
  it('names sections after their first element and its content', () => {
    const content = cloneSample()
    const names = flattenLayers(content).filter((row) => row.kind === 'section').map((row) => nodeName(row.node))
    expect(names[0]).toBe('Section · Hero slider')
    expect(names[1]).toBe('Section · Heading: Made fresh every morning')
    expect(names).toContain('Section · Product grid: Best sellers')
  })

  it('names elements by type and text; empty sections and columns plainly', () => {
    const content = cloneSample()
    expect(nodeName(findNode(content, 'e_text')!.node)).toBe('Text: Small batches, local farms and no shortcuts.')
    expect(nodeName(findNode(content, 'c_story_text')!.node)).toBe('Column')
    const empty = { ...(content.sections[0] as Section), columns: [] }
    expect(nodeName(empty)).toBe('Section · empty')
    const long = { ...(findNode(content, 'e_heading')!.node as object), props: { text: 'x'.repeat(80), level: 2, link: null } }
    expect(nodeSummary(long as never)!.length).toBeLessThanOrEqual(48)
  })
})

describe('custom HTML guard (B4)', () => {
  it('finds custom HTML in a node, its columns and inner rows', () => {
    const doc = cloneSample()
    const section = doc.sections[0] as Section
    expect(containsCustomHtml(section)).toBe(false)
    const html = { id: 'e_html', type: 'custom_html', props: { html: '<b>x</b>' }, style: {}, visibility: { desktop: true, tablet: true, mobile: true }, hidden: false, schedule: null, translations: {} }
    const withHtml = { ...section, columns: [{ ...section.columns[0]!, elements: [{ id: 'e_row', type: 'inner_row', props: {}, columns: [{ id: 'c_in', type: 'column', width: { base: 100 }, style: {}, elements: [html] }] }] }] } as unknown as Section
    expect(containsCustomHtml(withHtml)).toBe(true)
    expect(containsCustomHtml(html as never)).toBe(true)
  })

  it('knows each document kind’s elements and words', () => {
    expect(elementContext({ kind: 'page', key: 'cms:0b6f2e3c-1a2b-4c3d-8e9f-0123456789ab' })).toBe('cms')
    expect(elementContext({ kind: 'zone', key: 'zone:product.after' })).toBe('zone')
    expect(allowedIn({ type: 'copyright' }, 'footer')).toBe(true)
    expect(allowedIn({ type: 'copyright' }, 'header')).toBe(false)
    expect(allowedIn({ type: 'copyright', allowed_in: ['header'] }, 'header')).toBe(true)
    // P1b: product.after sits between the details and the related products.
    expect(kindInfo({ kind: 'zone', key: 'zone:product.after' })).toMatchObject({ noun: 'area', sample: 'around', placement: 'Below the product details on every product page.' })
    expect(kindInfo({ kind: 'zone', key: 'zone:listing.top' })).toMatchObject({ sample: 'below' })
    expect(kindInfo({ kind: 'page', key: 'home' })).toMatchObject({ noun: 'page', placement: null, sample: 'none' })
  })
})

describe('product zone versions (P1b)', () => {
  const SHOES = '0b6f2e3c-1a2b-4c3d-8e9f-0123456789ab'
  const SNEAKER = '1b6f2e3c-1a2b-4c3d-8e9f-0123456789ab'

  it('reads zone keys and makes version keys', () => {
    expect(parseZoneKey('zone:listing.top')).toEqual({ zone: 'zone:listing.top', target: null })
    expect(parseZoneKey('zone:product.bottom')).toEqual({ zone: 'zone:product.bottom', target: null })
    expect(parseZoneKey(`zone:product.below_price@category:${SHOES}`)).toEqual({ zone: 'zone:product.below_price', target: { type: 'category', id: SHOES } })
    expect(parseZoneKey(`zone:product.after@product:${SNEAKER}`)).toEqual({ zone: 'zone:product.after', target: { type: 'product', id: SNEAKER } })
    // Listing zones have no versions; malformed keys and other documents are not zones.
    expect(parseZoneKey(`zone:listing.top@category:${SHOES}`)).toBeNull()
    expect(parseZoneKey('zone:product.after@brand:x')).toBeNull()
    expect(parseZoneKey(`zone:product.after@category:${SHOES.toUpperCase()}`)).toBeNull()
    expect(parseZoneKey('home')).toBeNull()
    expect(targetedZoneKey('zone:product.bottom', 'category', SHOES.toUpperCase())).toBe(`zone:product.bottom@category:${SHOES}`)
    expect(isProductZone('zone:product.below_price')).toBe(true)
    expect(isProductZone('zone:listing.bottom')).toBe(false)
  })

  it('says where a version shows, naming its category or product', () => {
    expect(elementContext({ kind: 'zone', key: `zone:product.below_price@category:${SHOES}` })).toBe('zone')
    expect(kindInfo({ kind: 'zone', key: 'zone:product.below_price' })).toMatchObject({ sample: 'around', placement: 'Under the price on every product page, above Add to cart.' })
    expect(kindInfo({ kind: 'zone', key: `zone:product.below_price@category:${SHOES}`, target: { type: 'category', id: SHOES, name: 'Shoes' } }).placement).toBe(
      'Under the price on product pages in “Shoes” and its subcategories. A product’s own version wins over this one.',
    )
    expect(kindInfo({ kind: 'zone', key: `zone:product.bottom@product:${SNEAKER}`, target: { type: 'product', id: SNEAKER, name: 'Red sneaker' } })).toMatchObject({
      sample: 'above',
      placement: 'At the bottom of the “Red sneaker” product page only.',
    })
    expect(kindInfo({ kind: 'zone', key: `zone:product.after@category:${SHOES}`, target: { type: 'category', id: SHOES, name: null } }).placement).toMatch(/category that no longer exists/)
  })
})
