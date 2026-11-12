import { documentContext, elementMeta } from '@/storefront/builder/registry'
import type { DocumentContext } from '@/storefront/builder/types'
import type { DocumentKind, ZoneDocumentKey as ZoneKey } from './api'

/*
 * What kind of document the editor has open (B4) and what that means for people: which elements
 * it may hold (`allowed_in` of the element registry), the words the editor uses for it ("page",
 * "header", …) and where it shows on the store.
 */

/** The registry's `allowed_in` contexts. */
export type ElementContext = DocumentContext

export const ZONE_DOCUMENT_KEYS: readonly ZoneKey[] = ['zone:listing.top', 'zone:listing.bottom', 'zone:product.after']

/** The element context of a document: CMS pages (`cms:<uuid>`) have their own (FAQ list, contact form). */
export function elementContext(doc: { kind: DocumentKind; key: string }): ElementContext {
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
  /** Where the faded sample page sits on the canvas, around the document (B8b: a popup sits over it). */
  sample: 'none' | 'below' | 'above' | 'behind'
}

export const ZONE_TITLES: Record<ZoneKey, string> = {
  'zone:listing.top': 'Listing top',
  'zone:listing.bottom': 'Listing bottom',
  'zone:product.after': 'Product page',
}

export const ZONE_PLACEMENT: Record<ZoneKey, string> = {
  'zone:listing.top': 'Above the product grid on shop, category, brand and search pages.',
  'zone:listing.bottom': 'Below the product grid on shop, category, brand and search pages.',
  'zone:product.after': 'Below the product details on every product page.',
}

export function kindInfo(doc: { kind: DocumentKind; key: string }): KindInfo {
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
      const key = doc.key as ZoneKey
      return {
        noun: 'area',
        placement: ZONE_PLACEMENT[key] ?? 'Shown on your shop pages.',
        empty: 'This area is empty. Drag an element from the Add panel onto it — for example a banner or a call to action.',
        sample: key === 'zone:listing.top' ? 'below' : 'above',
      }
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
