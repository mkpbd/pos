import { useStorefront } from '../api'
import type { ProductLayout } from '../types'

/** Today's product page: gallery left, thumbnails under it, nothing sticky, details in tabs. */
export const DEFAULT_PRODUCT_LAYOUT: ProductLayout = { gallery: 'left', thumbnails: 'bottom', sticky_summary: false, details: 'tabs' }

const OPTIONS = {
  gallery: ['left', 'right'],
  thumbnails: ['bottom', 'side'],
  details: ['tabs', 'accordion', 'stacked'],
} as const

const pick = <K extends keyof typeof OPTIONS>(source: Record<string, unknown>, key: K): ProductLayout[K] =>
  ((OPTIONS[key] as readonly unknown[]).includes(source[key]) ? source[key] : DEFAULT_PRODUCT_LAYOUT[key]) as ProductLayout[K]

/** The theme's `layout.product` with every key set (P1b); missing or unknown values keep today's page. */
export function resolveProductLayout(value: unknown): ProductLayout {
  const source = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  return {
    gallery: pick(source, 'gallery'),
    thumbnails: pick(source, 'thumbnails'),
    sticky_summary: source.sticky_summary === true,
    details: pick(source, 'details'),
  }
}

/** The product page layout of the store's (or the previewed draft's) theme. */
export function useProductLayout(): ProductLayout {
  return resolveProductLayout(useStorefront().theme.layout.product)
}

/** The element id of a product detail part in the accordion or stacked layout, for scrolling to it. */
export const detailSectionId = (id: string) => `product-detail-${id}`
