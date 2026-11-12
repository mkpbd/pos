import { useStorefront } from '../api'
import { PageRenderer } from './page-renderer'
import { zonePayload } from './payload'
import type { ZoneKey } from './types'

/**
 * A store-builder content zone (B4): `listing.top` / `listing.bottom` around the product grid of
 * shop, category, brand and search pages, `product.after` below a product's details. The
 * published document from the bootstrap (staff `?preview=draft`: the draft); nothing without one.
 */
export function BuilderZone({ zone }: { zone: ZoneKey }) {
  const page = zonePayload(useStorefront(), zone)
  if (!page) return null
  return <PageRenderer page={page} testId={`builder-zone-${zone}`} className="b-zone" scope={`zone-${zone.replace('.', '-')}`} />
}
