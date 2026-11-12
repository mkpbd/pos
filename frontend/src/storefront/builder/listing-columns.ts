import type { ListingColumns } from '../types'

/*
 * Products per row of the listing grid (theme `layout.listing_columns`, B4) as Tailwind classes:
 * mobile below 768 px, tablet from `md` (768 px), desktop from `lg` (1024 px). The default
 * {desktop: 3, tablet: 3, mobile: 2} computes exactly today's `grid-cols-2 md:grid-cols-3`.
 * Every class is spelled out so Tailwind generates it.
 */

const MOBILE: Record<ListingColumns['mobile'], string> = { 1: 'grid-cols-1', 2: 'grid-cols-2' }
const TABLET: Record<ListingColumns['tablet'], string> = { 2: 'md:grid-cols-2', 3: 'md:grid-cols-3', 4: 'md:grid-cols-4' }
const DESKTOP: Record<ListingColumns['desktop'], string> = { 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4', 5: 'lg:grid-cols-5' }

export function listingGridClasses(columns: ListingColumns): string {
  return `${MOBILE[columns.mobile]} ${TABLET[columns.tablet]} ${DESKTOP[columns.desktop]}`
}
