import { cn } from '@/lib/utils'
import { useStorefront } from '../api'
import type { ProductDetail } from '../types'
import { PageRenderer } from './page-renderer'
import { productZonePayload, zonePayload } from './payload'
import type { BuilderPage, ProductZoneKey, ZoneKey } from './types'

/**
 * A store-builder content zone (B4): `listing.top` / `listing.bottom` around the product grid of
 * shop, category, brand and search pages. The published document from the bootstrap (staff
 * `?preview=draft`: the draft); nothing without one.
 */
export function BuilderZone({ zone }: { zone: ZoneKey }) {
  return <ZoneContent zone={zone} page={zonePayload(useStorefront(), zone)} />
}

/**
 * P1b: a zone of the product page — `product.below_price` in the summary column (`inline`: no side
 * padding of its own), `product.after` below the details and `product.bottom` at the end of the page —
 * drawn from the product's own resolved payload (its version, its category's, or the all-products one).
 */
export function ProductZone({ zone, product, inline = false }: { zone: ProductZoneKey; product: Pick<ProductDetail, 'zones'>; inline?: boolean }) {
  return <ZoneContent zone={zone} page={productZonePayload(product, useStorefront(), zone)} inline={inline} />
}

function ZoneContent({ zone, page, inline = false }: { zone: string; page: BuilderPage | null; inline?: boolean }) {
  if (!page) return null
  return <PageRenderer page={page} testId={`builder-zone-${zone}`} className={cn('b-zone', inline && 'b-zone-inline')} scope={`zone-${zone.replace('.', '-')}`} />
}
