/*
 * B14 editor model (pure): plain words for the live text fields and the store page main parts
 * (product listing, blog post, order summary, page-not-found message), and friendly messages for
 * their problems. Keys, fields, enums and the prop rules are the storefront's
 * (`@/storefront/builder/templates/types`, `b14PropProblems` / `dynamicFieldAllowed` in validate.ts).
 */

import { fieldsFor, type DynamicTextField, type DynamicTextFormat, type DynamicTextTag, type ProductListingFilters, type ProductListingScope, type StoreTemplateKey } from '@/storefront/builder/templates/types'
import type { SortKey } from '@/storefront/types'
import { B14_LIMITS, B14_TEXT_LIMITS, b14PropProblems, dynamicFieldAllowed, type PropProblem } from '@/storefront/builder/validate'

export const B14_TYPES: ReadonlySet<string> = new Set(['dynamic_text', 'product_listing', 'blog_post_body', 'order_summary', 'not_found_message'])

/** The store pages whose main part is the product listing (its scope is "this page's products" there). */
export const LISTING_TEMPLATES: readonly StoreTemplateKey[] = ['shop', 'category', 'brand', 'search']

export const isListingTemplate = (template: StoreTemplateKey | null): boolean => template !== null && LISTING_TEMPLATES.includes(template)

/* ----------------------------------------------------------------------------------------------
 * Live text ("Text from this page")
 * -------------------------------------------------------------------------------------------- */

type Source = 'category' | 'brand' | 'search' | 'post' | 'order' | 'store'

/** The field picker's groups, in the order they are listed (the page's own source first, the store last). */
export const FIELD_SOURCES: { source: Source; label: string }[] = [
  { source: 'category', label: 'This category' },
  { source: 'brand', label: 'This brand' },
  { source: 'search', label: 'This search' },
  { source: 'post', label: 'This blog post' },
  { source: 'order', label: 'This order' },
  { source: 'store', label: 'Your store' },
]

export const FIELD_LABELS: Record<DynamicTextField, string> = {
  'store.name': 'Store name',
  'store.phone': 'Store phone number',
  'store.email': 'Store email',
  'store.address': 'Store address',
  'category.name': 'Category name',
  'category.description': 'Category description',
  'category.product_count': 'Number of products in it',
  'brand.name': 'Brand name',
  'brand.description': 'Brand description',
  'brand.product_count': 'Number of products of the brand',
  'search.query': 'The words searched for',
  'search.result_count': 'Number of products found',
  'post.title': 'Post title',
  'post.excerpt': 'Short summary',
  'post.author': 'Writer’s name',
  'post.published_at': 'Date published',
  'post.reading_time': 'Reading time',
  'post.category': 'Post category',
  'order.number': 'Order number',
  'order.status': 'Order status',
  'order.total': 'Order total',
  'order.placed_at': 'Date ordered',
  'order.customer_first_name': 'Shopper’s first name',
  'order.payment_method': 'Payment method',
  'order.delivery_eta': 'Expected delivery',
}

export const fieldLabel = (field: string): string => FIELD_LABELS[field as DynamicTextField] ?? field

/** The fields a document may use, grouped for the picker (empty groups left out). */
export function fieldGroups(template: StoreTemplateKey | null): { source: Source; label: string; fields: { value: DynamicTextField; label: string }[] }[] {
  const fields = fieldsFor(template)
  return FIELD_SOURCES.map((group) => ({
    ...group,
    fields: fields.filter((f) => f.startsWith(`${group.source}.`)).map((value) => ({ value, label: FIELD_LABELS[value] ?? value })),
  })).filter((group) => group.fields.length > 0)
}

export const TAG_OPTIONS: { value: DynamicTextTag; label: string }[] = [
  { value: 'p', label: 'Paragraph' },
  { value: 'h1', label: 'Heading 1 – largest (once per page)' },
  { value: 'h2', label: 'Heading 2 – section title' },
  { value: 'h3', label: 'Heading 3' },
  { value: 'span', label: 'Text in the line (no new paragraph)' },
]

export const FORMAT_OPTIONS: { value: DynamicTextFormat; label: string }[] = [
  { value: 'default', label: 'As it fits the field' },
  { value: 'money', label: 'Money (৳ 1,250)' },
  { value: 'number', label: 'Number (1,250)' },
  { value: 'date', label: 'Date (12 Nov 2026)' },
]

/* ----------------------------------------------------------------------------------------------
 * Product listing
 * -------------------------------------------------------------------------------------------- */

/** The scopes a normal page chooses from (store page templates show "this page's products"). */
export const PAGE_SCOPES: { value: Exclude<ProductListingScope, 'current'>; label: string }[] = [
  { value: 'all', label: 'All products' },
  { value: 'categories', label: 'Products in the categories I choose' },
  { value: 'brands', label: 'Products of the brands I choose' },
  { value: 'on_sale', label: 'Products on sale' },
  { value: 'new_arrivals', label: 'Newest products' },
]

/** What "this page's products" means on each listing template. */
export const CURRENT_SCOPE_TEXT: Partial<Record<StoreTemplateKey, string>> = {
  shop: 'Shows all your products, with the filters shoppers choose.',
  category: 'Shows the products of the category being viewed (and its subcategories).',
  brand: 'Shows the products of the brand being viewed.',
  search: 'Shows the products that match what the shopper searched for.',
}

export const FILTER_OPTIONS: { key: keyof ProductListingFilters; label: string }[] = [
  { key: 'price', label: 'Price range' },
  { key: 'category', label: 'Category' },
  { key: 'brand', label: 'Brand' },
  { key: 'attributes', label: 'Options such as size and colour' },
  { key: 'availability', label: 'In stock only' },
  { key: 'on_sale', label: 'On sale' },
]

export const FILTER_LAYOUTS = [
  { value: 'sidebar', label: 'In a column beside the products' },
  { value: 'top', label: 'In a bar above the products' },
  { value: 'drawer', label: 'Behind a “Filters” button' },
] as const

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'featured', label: 'Featured first' },
  { value: 'popularity', label: 'Most popular' },
  { value: 'latest', label: 'Newest first' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'name', label: 'Name (A to Z)' },
  { value: 'rating', label: 'Best rated' },
]

export const PAGINATION_OPTIONS = [
  { value: 'pages', label: 'Page numbers' },
  { value: 'load_more', label: 'A “Load more” button' },
] as const

export const PER_PAGE_OPTIONS = B14_LIMITS.perPage.map((n) => ({ value: String(n), label: `${n} products` }))

export const COLUMN_DEVICES = [
  { device: 'desktop', label: 'Computers' },
  { device: 'tablet', label: 'Tablets' },
  { device: 'mobile', label: 'Phones' },
] as const

/** The products-per-row choices of a device (the theme's listing ranges). */
export function columnOptions(device: 'desktop' | 'tablet' | 'mobile'): { value: string; label: string }[] {
  const { min, max } = B14_LIMITS.columns[device]
  return Array.from({ length: max - min + 1 }, (_, i) => min + i).map((n) => ({ value: String(n), label: `${n} in a row` }))
}

/** An id ticked or unticked in a scope list (kept in the order chosen, at most 20). */
export function toggleId(ids: readonly string[], id: string, on: boolean): string[] {
  const rest = ids.filter((x) => x !== id)
  return on ? [...rest, id].slice(0, B14_LIMITS.scopeIds.max) : rest
}

/* ----------------------------------------------------------------------------------------------
 * Problems
 * -------------------------------------------------------------------------------------------- */

const NAMES: Record<string, string> = {
  prefix: 'Words before',
  suffix: 'Words after',
  fallback: 'Text when empty',
  heading: 'Heading',
  text: 'Text',
}

/** A friendly message for a B14 prop problem. */
export function b14Message(type: string, problem: PropProblem): string {
  const field = problem.path.split('.')[0] ?? ''
  if (problem.code === 'too_long') {
    const max = (B14_TEXT_LIMITS as Record<string, Record<string, number>>)[type]?.[field]
    return max ? `${NAMES[field] ?? 'This'}: at most ${max} characters.` : 'This is too long.'
  }
  switch (`${type}.${field}`) {
    case 'dynamic_text.field':
      return 'Choose what to show.'
    case 'product_listing.category_ids':
      if (problem.code === 'too_few') return 'Tick at least one category.'
      if (problem.code === 'too_many') return `Tick at most ${B14_LIMITS.scopeIds.max} categories.`
      return 'A ticked category no longer exists. Untick it.'
    case 'product_listing.brand_ids':
      if (problem.code === 'too_few') return 'Tick at least one brand.'
      if (problem.code === 'too_many') return `Tick at most ${B14_LIMITS.scopeIds.max} brands.`
      return 'A ticked brand no longer exists. Untick it.'
    case 'product_listing.per_page':
      return 'Choose 12, 24, 36 or 48 products per page.'
    case 'product_listing.columns':
      return 'Choose how many products sit in a row on each screen size.'
  }
  return problem.code === 'invalid' && (field.startsWith('show_') || field === 'filters') ? 'This is on or off.' : 'Choose one of the options.'
}

/**
 * Every B14 problem of a node (props, the live text field of this page, the listing's scope):
 * `{path: 'props.<field>', message}`. `template` = the store page of the document (null: a normal page).
 */
export function b14Problems(type: string, props: unknown, template: StoreTemplateKey | null, isTemplate: boolean): { path: string; message: string }[] {
  const out = b14PropProblems(type, props).map((problem) => ({ path: `props.${problem.path}`, message: b14Message(type, problem) }))
  const p = (props ?? {}) as Record<string, unknown>
  if (type === 'dynamic_text' && !out.some((x) => x.path === 'props.field') && !dynamicFieldAllowed(p.field, template)) {
    out.push({ path: 'props.field', message: `This page has no “${fieldLabel(String(p.field))}”. Choose something this page knows.` })
  }
  if (type === 'product_listing' && !out.some((x) => x.path === 'props.scope')) {
    if (isListingTemplate(template) && p.scope !== 'current') out.push({ path: 'props.scope', message: 'On this store page the list shows the page’s own products.' })
    else if (!isListingTemplate(template) && p.scope === 'current') {
      out.push({ path: 'props.scope', message: isTemplate ? 'A product list can’t show “this page’s products” here.' : 'Choose which products to show.' })
    }
  }
  return out
}
