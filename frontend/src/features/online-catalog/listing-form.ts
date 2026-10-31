import type { UseFormSetError } from 'react-hook-form'
import { z } from 'zod'
import { SLUG_PATTERN } from '@/features/content/slug'
import type { ListingState, ProductListingInput, ProductListingResponse, RelatedInput, RelatedProduct } from '@/features/online-catalog/api'
import { fromLocalInput, toLocalInput } from '@/features/storefront/schedule'
import { ApiError } from '@/lib/api/client'
import { handleFormError } from '@/lib/forms'
import { compareDecimal, MONEY_PATTERN } from '@/lib/money'

export const MAX_SPECIFICATIONS = 30
export const MAX_RELATED = 12
export const SEO_TITLE_MAX = 70
export const SEO_DESCRIPTION_MAX = 160
export const SHORT_DESCRIPTION_MAX = 500
export const SLUG_MAX = 120

export const LISTING_STATE: Record<ListingState, { label: string; variant: 'soft' | 'info' | 'success' | 'warning' }> = {
  draft: { label: 'Draft', variant: 'soft' },
  scheduled: { label: 'Scheduled', variant: 'info' },
  live: { label: 'Live', variant: 'success' },
  expired: { label: 'Ended', variant: 'warning' },
}

export const SLUG_MESSAGE = 'Lower-case letters, digits and single hyphens, e.g. mango-juice.'

/** Optional web address: empty lets the server derive one from the name. */
export const optionalSlug = z.union([z.literal(''), z.string().max(SLUG_MAX, `At most ${SLUG_MAX} characters.`).regex(SLUG_PATTERN, SLUG_MESSAGE)])

const pickedProduct = z.object({ id: z.string(), name: z.string(), image_url: z.string().nullable(), sku: z.string().nullable() })

export const listingFormSchema = z
  .object({
    is_published: z.boolean(),
    /** datetime-local values ("" = not set). */
    published_at: z.string(),
    unpublished_at: z.string(),
    slug: optionalSlug,
    is_featured: z.boolean(),
    /** yyyy-mm-dd or "". */
    is_new_until: z.string(),
    short_description: z.string().max(SHORT_DESCRIPTION_MAX, `At most ${SHORT_DESCRIPTION_MAX} characters.`),
    description_html: z.string(),
    specifications: z
      .array(z.object({ label: z.string().trim().min(1, 'Enter a label.').max(60, 'At most 60 characters.'), value: z.string().trim().min(1, 'Enter a value.').max(200, 'At most 200 characters.') }))
      .max(MAX_SPECIFICATIONS, `At most ${MAX_SPECIFICATIONS} rows.`),
    seo_title: z.string().max(SEO_TITLE_MAX, `At most ${SEO_TITLE_MAX} characters.`),
    seo_description: z.string().max(SEO_DESCRIPTION_MAX, `At most ${SEO_DESCRIPTION_MAX} characters.`),
    sort_weight: z.string().trim().regex(/^-?\d{1,6}$/, 'A whole number.'),
    variants: z.array(
      z.object({
        variant_id: z.string(),
        /** Read-only, for the compare-at check. */
        selling_price: z.string(),
        compare_at_price: z.union([z.literal(''), z.string().trim().regex(MONEY_PATTERN, 'Amount with up to 2 decimals.')]),
        image_id: z.string().nullable(),
      }),
    ),
    related: z.array(pickedProduct).max(MAX_RELATED, `At most ${MAX_RELATED} products.`),
    frequently_bought: z.array(pickedProduct).max(MAX_RELATED, `At most ${MAX_RELATED} products.`),
  })
  .superRefine((form, ctx) => {
    if (form.published_at && form.unpublished_at && form.unpublished_at <= form.published_at) {
      ctx.addIssue({ code: 'custom', path: ['unpublished_at'], message: 'The end must be after the start.' })
    }
    form.variants.forEach((v, i) => {
      const compare = v.compare_at_price.trim()
      if (compare && MONEY_PATTERN.test(compare) && compareDecimal(compare, v.selling_price) <= 0) {
        ctx.addIssue({ code: 'custom', path: ['variants', i, 'compare_at_price'], message: 'Must be higher than the selling price.' })
      }
    })
  })

export type ListingFormValues = z.infer<typeof listingFormSchema>

const toPicked = (p: RelatedProduct) => ({ id: p.id, name: p.name, image_url: p.image_url ?? null, sku: p.sku ?? null })

export function toListingFormValues(data: ProductListingResponse): ListingFormValues {
  const { listing } = data
  const byVariant = new Map(data.variants.map((v) => [v.variant_id, v]))

  return {
    is_published: listing.is_published,
    published_at: toLocalInput(listing.published_at),
    unpublished_at: toLocalInput(listing.unpublished_at),
    slug: listing.slug,
    is_featured: listing.is_featured,
    is_new_until: listing.is_new_until?.slice(0, 10) ?? '',
    short_description: listing.short_description ?? '',
    description_html: listing.description_html ?? '',
    specifications: listing.specifications.map((s) => ({ label: s.label, value: s.value })),
    seo_title: listing.seo_title ?? '',
    seo_description: listing.seo_description ?? '',
    sort_weight: String(listing.sort_weight),
    variants: data.product.variants.map((v) => ({
      variant_id: v.id,
      selling_price: v.selling_price,
      compare_at_price: byVariant.get(v.id)?.compare_at_price ?? '',
      image_id: byVariant.get(v.id)?.image_id ?? null,
    })),
    related: data.related.related.map(toPicked),
    frequently_bought: data.related.frequently_bought.map(toPicked),
  }
}

export function toListingInput(form: ListingFormValues): { listing: ProductListingInput; related: RelatedInput } {
  const text = (v: string) => v.trim() || null
  return {
    listing: {
      ...(form.slug ? { slug: form.slug } : {}),
      is_published: form.is_published,
      published_at: fromLocalInput(form.published_at),
      unpublished_at: fromLocalInput(form.unpublished_at),
      is_featured: form.is_featured,
      is_new_until: form.is_new_until || null,
      short_description: text(form.short_description),
      description_html: form.description_html || null,
      specifications: form.specifications.map((s) => ({ label: s.label.trim(), value: s.value.trim() })),
      seo_title: text(form.seo_title),
      seo_description: text(form.seo_description),
      sort_weight: Number(form.sort_weight),
      variants: form.variants.map((v) => ({ variant_id: v.variant_id, compare_at_price: v.compare_at_price.trim() || null, image_id: v.image_id })),
    },
    related: { related: form.related.map((p) => p.id), frequently_bought: form.frequently_bought.map((p) => p.id) },
  }
}

const LISTING_FIELDS = [
  'is_published', 'published_at', 'unpublished_at', 'slug', 'is_featured', 'is_new_until', 'short_description', 'description_html',
  'specifications', 'seo_title', 'seo_description', 'sort_weight', 'variants', 'related', 'frequently_bought',
] as const

/**
 * Puts a failed save on the right fields: validation details by their dotted keys, and the
 * listing's business rules (COMPARE_AT_NOT_ABOVE_PRICE on the variant named in the details,
 * PRODUCT_NOT_SELLABLE on the publish switch, SLUG_TAKEN on the address). Anything else is a toast.
 */
export function applyListingError(error: unknown, setError: UseFormSetError<ListingFormValues>, variantIds: string[]): void {
  if (error instanceof ApiError && error.code !== 'VALIDATION_FAILED') {
    if (error.code === 'COMPARE_AT_NOT_ABOVE_PRICE') {
      const variantId = typeof error.details.variant_id === 'string' ? error.details.variant_id : null
      const index = variantId ? variantIds.indexOf(variantId) : -1
      if (index >= 0) return setError(`variants.${index}.compare_at_price`, { type: 'server', message: error.message })
    }
    if (error.code === 'PRODUCT_NOT_SELLABLE') return setError('is_published', { type: 'server', message: error.message })
    if (error.code === 'SLUG_TAKEN') return setError('slug', { type: 'server', message: error.message })
  }
  handleFormError(error, setError, LISTING_FIELDS, { nested: true })
}

/** "12/70" style counter text for a length-limited field. */
export function counter(value: string, max: number): string {
  return `${value.length}/${max}`
}
