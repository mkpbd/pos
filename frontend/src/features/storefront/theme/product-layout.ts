import { z } from 'zod'
import type { ThemeDocument } from '@/features/storefront/api'

/*
 * P1b: how every product page is arranged — the theme's `layout.product`, saved with the theme
 * draft and published like the other layout keys. Shared by the Theme page and the store builder's
 * Site styles panel (value in, value out). The first option of each list is today's look.
 */

export const PRODUCT_LAYOUT_OPTIONS = {
  gallery: ['left', 'right'],
  thumbnails: ['bottom', 'side'],
  details: ['tabs', 'accordion', 'stacked'],
} as const

export type ProductGallerySide = (typeof PRODUCT_LAYOUT_OPTIONS.gallery)[number]
export type ProductThumbnails = (typeof PRODUCT_LAYOUT_OPTIONS.thumbnails)[number]
export type ProductDetailsStyle = (typeof PRODUCT_LAYOUT_OPTIONS.details)[number]

export type ProductLayout = {
  /** The photos' side on wide screens (phones show the photos first). */
  gallery: ProductGallerySide
  /** The small photos: under the main photo, or a column beside it on wide screens. */
  thumbnails: ProductThumbnails
  /** The name, price and buy box stay in view while the photos scroll (wide screens). */
  sticky_summary: boolean
  /** Description, specifications and reviews: tabs, fold-out sections, or one after another. */
  details: ProductDetailsStyle
}

export const PRODUCT_LAYOUT_KEYS = ['gallery', 'thumbnails', 'sticky_summary', 'details'] as const satisfies readonly (keyof ProductLayout)[]

/** Today's product page; the API fills the same values in. */
export const DEFAULT_PRODUCT_LAYOUT: ProductLayout = { gallery: 'left', thumbnails: 'bottom', sticky_summary: false, details: 'tabs' }

/** The theme form's rules (the API checks the same values). */
export const productLayoutSchema = z.object({
  gallery: z.enum(PRODUCT_LAYOUT_OPTIONS.gallery),
  thumbnails: z.enum(PRODUCT_LAYOUT_OPTIONS.thumbnails),
  sticky_summary: z.boolean(),
  details: z.enum(PRODUCT_LAYOUT_OPTIONS.details),
})

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return typeof value === 'string' && (options as readonly string[]).includes(value) ? (value as T) : fallback
}

/** Every key filled in; missing or unknown values are today's look. */
export function normalizeProductLayout(value: unknown): ProductLayout {
  const v = value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    gallery: oneOf(v.gallery, PRODUCT_LAYOUT_OPTIONS.gallery, DEFAULT_PRODUCT_LAYOUT.gallery),
    thumbnails: oneOf(v.thumbnails, PRODUCT_LAYOUT_OPTIONS.thumbnails, DEFAULT_PRODUCT_LAYOUT.thumbnails),
    sticky_summary: typeof v.sticky_summary === 'boolean' ? v.sticky_summary : DEFAULT_PRODUCT_LAYOUT.sticky_summary,
    details: oneOf(v.details, PRODUCT_LAYOUT_OPTIONS.details, DEFAULT_PRODUCT_LAYOUT.details),
  }
}

export function isDefaultProductLayout(value: ProductLayout): boolean {
  return PRODUCT_LAYOUT_KEYS.every((key) => value[key] === DEFAULT_PRODUCT_LAYOUT[key])
}

type LayoutWithProduct = ThemeDocument['layout'] & { product?: unknown }

/** Whether the theme document has `layout.product` (every theme does once the API knows the key). */
export function hasProductLayout(settings: ThemeDocument | null | undefined): boolean {
  return (settings?.layout as LayoutWithProduct | undefined)?.product !== undefined
}

/** The theme's product layout with every key filled in. */
export function productLayoutOf(settings: ThemeDocument | null | undefined): ProductLayout {
  return normalizeProductLayout((settings?.layout as LayoutWithProduct | undefined)?.product)
}

/** The theme document with another product layout; every other layout key is kept. */
export function withProductLayout(settings: ThemeDocument, product: ProductLayout): ThemeDocument {
  return { ...settings, layout: { ...settings.layout, product } as ThemeDocument['layout'] }
}

/** The owner's words for each choice. */
export const PRODUCT_LAYOUT_LABELS = {
  gallery: { left: 'Photos on the left', right: 'Photos on the right' },
  thumbnails: { bottom: 'Under the main photo', side: 'Beside the main photo' },
  details: { tabs: 'Tabs', accordion: 'Fold-out sections', stacked: 'One after another' },
} as const satisfies { [K in keyof typeof PRODUCT_LAYOUT_OPTIONS]: Record<(typeof PRODUCT_LAYOUT_OPTIONS)[K][number], string> }

/** One sentence describing a layout, e.g. for the preview's text alternative. */
export function describeProductLayout(value: ProductLayout): string {
  const parts = [
    value.gallery === 'left' ? 'photos on the left' : 'photos on the right',
    value.thumbnails === 'bottom' ? 'small photos under the main photo' : 'small photos beside the main photo',
    value.sticky_summary ? 'price and Add to cart stay in view while scrolling' : 'price and Add to cart scroll with the page',
    value.details === 'tabs' ? 'details in tabs' : value.details === 'accordion' ? 'details in fold-out sections' : 'details one after another',
  ]
  return `Product page: ${parts.join(', ')}.`
}
