import { documentContext, elementMeta } from '@/storefront/builder/registry'
import type { DocumentContext } from '@/storefront/builder/types'
import type { DocumentKind, ProductZoneKey, TargetedZoneKey, ZoneDocumentKey as ZoneKey, ZoneTarget } from './api'

/*
 * What kind of document the editor has open (B4) and what that means for people: which elements
 * it may hold (`allowed_in` of the element registry), the words the editor uses for it ("page",
 * "header", …) and where it shows on the store.
 * P1b: three product page zones, each with versions for one category or one product
 * (`zone:<zone>@category:<uuid>`); on a product page the most specific published version shows.
 */

/** The registry's `allowed_in` contexts. */
export type ElementContext = DocumentContext

export const LISTING_ZONE_KEYS = ['zone:listing.top', 'zone:listing.bottom'] as const satisfies readonly ZoneKey[]

/** P1b: in the order they sit on the product page. */
export const PRODUCT_ZONE_KEYS = ['zone:product.below_price', 'zone:product.after', 'zone:product.bottom'] as const satisfies readonly ProductZoneKey[]

export const ZONE_DOCUMENT_KEYS: readonly ZoneKey[] = [...LISTING_ZONE_KEYS, ...PRODUCT_ZONE_KEYS]

export const isProductZone = (key: string): key is ProductZoneKey => (PRODUCT_ZONE_KEYS as readonly string[]).includes(key)

const TARGETED = /^(zone:product\.(?:below_price|after|bottom))@(category|product):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/

/** A zone document's zone and, for a version, what it is for; null for other keys. */
export function parseZoneKey(key: string): { zone: ZoneKey; target: { type: ZoneTarget['type']; id: string } | null } | null {
  if ((ZONE_DOCUMENT_KEYS as readonly string[]).includes(key)) return { zone: key as ZoneKey, target: null }
  const match = TARGETED.exec(key)
  if (!match) return null
  return { zone: match[1] as ProductZoneKey, target: { type: match[2] as ZoneTarget['type'], id: match[3]! } }
}

/** The key of a product zone's version for a category or a product (ids are lower case on the server). */
export function targetedZoneKey(zone: ProductZoneKey, type: ZoneTarget['type'], id: string): TargetedZoneKey {
  return `${zone}@${type}:${id.toLowerCase()}`
}

/** The element context of a document: CMS pages (`cms:<uuid>`) have their own (FAQ list, contact form). */
export function elementContext(doc: { kind: DocumentKind; key: string; context?: 'page' | 'header' | 'footer' | null }): ElementContext {
  // B9: a global section holds what its context allows (page: pages, CMS pages and shop areas alike).
  if (doc.kind === 'global') return doc.context ?? 'page'
  if (doc.kind === 'header' || doc.kind === 'footer' || doc.kind === 'zone' || doc.kind === 'popup') return doc.kind
  return documentContext(doc.key)
}

/**
 * Whether an element type may be added to a document of this context: the server's `allowed_in`,
 * else the storefront registry's; unknown types go on pages only.
 */
export function allowedIn(meta: { type: string; allowed_in?: readonly string[] }, context: ElementContext): boolean {
  return (meta.allowed_in ?? elementMeta(meta.type)?.allowed_in ?? ['page', 'cms', 'zone']).includes(context)
}

export type KindInfo = {
  /** "page", "header", "footer", "area". */
  noun: string
  /** Where it shows, for the strip above the canvas (null: a normal page, no strip). */
  placement: string | null
  /** The canvas text while it is empty. */
  empty: string
  /** Where the faded sample page sits on the canvas, around the document (B8b: a popup sits over it; P1b: product zones sit between parts of the product page). */
  sample: 'none' | 'below' | 'above' | 'around' | 'behind'
}

/** The editor's (English) names of the areas; new documents are created with them. */
export const ZONE_TITLES: Record<ZoneKey, string> = {
  'zone:listing.top': 'Listing top',
  'zone:listing.bottom': 'Listing bottom',
  'zone:product.below_price': 'Under the price',
  'zone:product.after': 'Product page',
  'zone:product.bottom': 'Product page bottom',
}

export const ZONE_PLACEMENT: Record<ZoneKey, string> = {
  'zone:listing.top': 'Above the product grid on shop, category, brand and search pages.',
  'zone:listing.bottom': 'Below the product grid on shop, category, brand and search pages.',
  'zone:product.below_price': 'Under the price on every product page, above Add to cart.',
  'zone:product.after': 'Below the product details on every product page.',
  'zone:product.bottom': 'At the very bottom of every product page, after related products.',
}

/** P1b: where a product zone's version for a category or a product shows. */
const VERSION_PLACEMENT: Record<ProductZoneKey, { where: string; category: (name: string) => string; product: (name: string) => string }> = {
  'zone:product.below_price': {
    where: 'Under the price',
    category: (name) => `Under the price on product pages in “${name}” and its subcategories.`,
    product: (name) => `Under the price on the “${name}” product page only.`,
  },
  'zone:product.after': {
    where: 'Below the product details',
    category: (name) => `Below the product details on product pages in “${name}” and its subcategories.`,
    product: (name) => `Below the product details on the “${name}” product page only.`,
  },
  'zone:product.bottom': {
    where: 'At the bottom of the product page',
    category: (name) => `At the bottom of product pages in “${name}” and its subcategories.`,
    product: (name) => `At the bottom of the “${name}” product page only.`,
  },
}

const ZONE_SAMPLE: Record<ZoneKey, KindInfo['sample']> = {
  'zone:listing.top': 'below',
  'zone:listing.bottom': 'above',
  'zone:product.below_price': 'around',
  'zone:product.after': 'around',
  'zone:product.bottom': 'above',
}

/** Where a zone document shows; a version names its category or product (`target.name`, null when it is gone). */
function zonePlacement(key: string, target: ZoneTarget | null | undefined): string {
  const parsed = parseZoneKey(key)
  if (!parsed) return 'Shown on your shop pages.'
  if (!parsed.target) return ZONE_PLACEMENT[parsed.zone]
  const words = VERSION_PLACEMENT[parsed.zone as ProductZoneKey]
  const name = target && target.id === parsed.target.id ? target.name : null
  const type = parsed.target.type
  if (name === null) return `${words.where} — for a ${type} that no longer exists, so shoppers don’t see this version.`
  return type === 'category' ? `${words.category(name)} A product’s own version wins over this one.` : words.product(name)
}

export function kindInfo(doc: { kind: DocumentKind; key: string; target?: ZoneTarget | null }): KindInfo {
  switch (doc.kind) {
    case 'header':
      return {
        noun: 'header',
        placement: 'Shown at the top of every page. On phones the store uses its compact header.',
        empty: 'Your header is empty. Drag the logo, a menu or the cart from the Add panel onto this area.',
        sample: 'below',
      }
    case 'footer':
      return {
        noun: 'footer',
        placement: 'Shown at the bottom of every page, on all screen sizes.',
        empty: 'Your footer is empty. Drag a menu, contact details or social icons from the Add panel onto this area.',
        sample: 'above',
      }
    case 'zone': {
      const zone = parseZoneKey(doc.key)?.zone
      return {
        noun: 'area',
        placement: zonePlacement(doc.key, doc.target),
        empty: 'This area is empty. Drag an element from the Add panel onto it — for example a banner or a call to action.',
        sample: zone ? ZONE_SAMPLE[zone] : 'above',
      }
    }
    case 'global':
      return {
        noun: 'global section',
        placement: 'A global section shows the same on every page that uses it. Publish it to update all of them at once.',
        empty: 'This global section is empty. Drag an element from the Add panel onto it.',
        sample: 'none',
      }
    case 'popup':
      return {
        noun: 'popup',
        placement: 'Shown on your shop as set in Popup settings, once it is published and switched on. Never on the cart, checkout, account or order pages.',
        empty: 'This popup is empty. Drag a heading, a text, a button or a form from the Add panel into it.',
        sample: 'behind',
      }
    default:
      return { noun: 'page', placement: null, empty: 'This page is empty. Drag an element from the Add panel onto this area, or click one to add it.', sample: 'none' }
  }
}
