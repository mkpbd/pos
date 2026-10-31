import { z } from 'zod'
import type { BrandListingInput, BrandListingResponse, CategoryListingInput, CategoryListingResponse, WebBrandRow, WebCategoryRow } from '@/features/online-catalog/api'
import { optionalSlug, SEO_DESCRIPTION_MAX, SEO_TITLE_MAX } from '@/features/online-catalog/listing-form'

export const BRAND_DESCRIPTION_MAX = 1000

const seo = {
  seo_title: z.string().max(SEO_TITLE_MAX, `At most ${SEO_TITLE_MAX} characters.`),
  seo_description: z.string().max(SEO_DESCRIPTION_MAX, `At most ${SEO_DESCRIPTION_MAX} characters.`),
}

export const categoryListingSchema = z.object({
  is_visible: z.boolean(),
  slug: optionalSlug,
  image_media_id: z.string().nullable(),
  banner_media_id: z.string().nullable(),
  description_html: z.string(),
  ...seo,
})
export type CategoryListingValues = z.infer<typeof categoryListingSchema>

export const brandListingSchema = z.object({
  is_visible: z.boolean(),
  slug: optionalSlug,
  logo_media_id: z.string().nullable(),
  description: z.string().max(BRAND_DESCRIPTION_MAX, `At most ${BRAND_DESCRIPTION_MAX} characters.`),
  ...seo,
})
export type BrandListingValues = z.infer<typeof brandListingSchema>

export function toCategoryValues({ listing }: CategoryListingResponse): CategoryListingValues {
  return {
    is_visible: listing.is_visible,
    slug: listing.slug,
    image_media_id: listing.image_media_id,
    banner_media_id: listing.banner_media_id,
    description_html: listing.description_html ?? '',
    seo_title: listing.seo_title ?? '',
    seo_description: listing.seo_description ?? '',
  }
}

export function toCategoryInput(v: CategoryListingValues): CategoryListingInput {
  return {
    ...(v.slug ? { slug: v.slug } : {}),
    is_visible: v.is_visible,
    image_media_id: v.image_media_id,
    banner_media_id: v.banner_media_id,
    description_html: v.description_html || null,
    seo_title: v.seo_title.trim() || null,
    seo_description: v.seo_description.trim() || null,
  }
}

export function toBrandValues({ listing }: BrandListingResponse): BrandListingValues {
  return {
    is_visible: listing.is_visible,
    slug: listing.slug,
    logo_media_id: listing.logo_media_id,
    description: listing.description ?? '',
    seo_title: listing.seo_title ?? '',
    seo_description: listing.seo_description ?? '',
  }
}

export function toBrandInput(v: BrandListingValues): BrandListingInput {
  return {
    ...(v.slug ? { slug: v.slug } : {}),
    is_visible: v.is_visible,
    logo_media_id: v.logo_media_id,
    description: v.description.trim() || null,
    seo_title: v.seo_title.trim() || null,
    seo_description: v.seo_description.trim() || null,
  }
}

export type WebStatus = { label: string; variant: 'success' | 'soft' | 'outline' | 'warning' }

/** What a visitor sees: a page only exists for an active record with a visible listing. */
export function webStatus(row: Pick<WebCategoryRow | WebBrandRow, 'is_active' | 'listing'>): WebStatus {
  if (!row.listing) return { label: 'Not listed', variant: 'outline' }
  if (!row.listing.is_visible) return { label: 'Hidden', variant: 'soft' }
  if (!row.is_active) return { label: 'Inactive', variant: 'warning' }
  return { label: 'Visible', variant: 'success' }
}
