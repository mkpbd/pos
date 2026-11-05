import { z } from 'zod'
import type { BrandListingInput, BrandListingResponse, CategoryListingInput, CategoryListingResponse, WebBrandRow, WebCategoryRow } from '@/features/online-catalog/api'
import { optionalSlug, SEO_DESCRIPTION_MAX, SEO_TITLE_MAX } from '@/features/online-catalog/listing-form'
import { readBn, toTranslationsInput, translationsSchema, type TranslationsMap } from '@/features/translations/translations'

export const BRAND_DESCRIPTION_MAX = 1000
/** Catalog limits of category and brand names. */
export const TERM_NAME_MAX = 100

/** Translatable fields (E12b) with the base fields' limits. */
export const CATEGORY_TRANSLATIONS = [
  { name: 'name', max: TERM_NAME_MAX },
  { name: 'description_html' },
  { name: 'seo_title', max: SEO_TITLE_MAX },
  { name: 'seo_description', max: SEO_DESCRIPTION_MAX },
] as const
export const BRAND_TRANSLATIONS = [
  { name: 'name', max: TERM_NAME_MAX },
  { name: 'description', max: BRAND_DESCRIPTION_MAX },
  { name: 'seo_title', max: SEO_TITLE_MAX },
  { name: 'seo_description', max: SEO_DESCRIPTION_MAX },
] as const
const CATEGORY_NAMES = CATEGORY_TRANSLATIONS.map((f) => f.name)
const BRAND_NAMES = BRAND_TRANSLATIONS.map((f) => f.name)

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
  translations: translationsSchema(CATEGORY_TRANSLATIONS),
})
export type CategoryListingValues = z.infer<typeof categoryListingSchema>

export const brandListingSchema = z.object({
  is_visible: z.boolean(),
  slug: optionalSlug,
  logo_media_id: z.string().nullable(),
  description: z.string().max(BRAND_DESCRIPTION_MAX, `At most ${BRAND_DESCRIPTION_MAX} characters.`),
  ...seo,
  translations: translationsSchema(BRAND_TRANSLATIONS),
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
    translations: { bn: readBn(listing.translations, CATEGORY_NAMES) },
  }
}

export function toCategoryInput(v: CategoryListingValues, before?: TranslationsMap): CategoryListingInput {
  return {
    ...(v.slug ? { slug: v.slug } : {}),
    is_visible: v.is_visible,
    image_media_id: v.image_media_id,
    banner_media_id: v.banner_media_id,
    description_html: v.description_html || null,
    seo_title: v.seo_title.trim() || null,
    seo_description: v.seo_description.trim() || null,
    translations: toTranslationsInput(v.translations.bn, CATEGORY_NAMES, before),
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
    translations: { bn: readBn(listing.translations, BRAND_NAMES) },
  }
}

export function toBrandInput(v: BrandListingValues, before?: TranslationsMap): BrandListingInput {
  return {
    ...(v.slug ? { slug: v.slug } : {}),
    is_visible: v.is_visible,
    logo_media_id: v.logo_media_id,
    description: v.description.trim() || null,
    seo_title: v.seo_title.trim() || null,
    seo_description: v.seo_description.trim() || null,
    translations: toTranslationsInput(v.translations.bn, BRAND_NAMES, before),
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
