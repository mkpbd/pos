import type { BlogPostDetail, OrderView, ProductListing, SortKey } from '../../types'

/*
 * B14: store page templates — the shapes shared by the storefront routes, the five template
 * elements, the editor canvas (sample context) and the editor. One place for every B14 type; the
 * server (Storefront module) defines the same keys, props and context fields.
 */

/** The store pages a template can design (document key `template:<key>`, kind `page`, context `template`). */
export type StoreTemplateKey = 'shop' | 'category' | 'brand' | 'search' | 'blog_post' | 'order' | 'not_found'

export const STORE_TEMPLATE_KEYS = ['shop', 'category', 'brand', 'search', 'blog_post', 'order', 'not_found'] as const satisfies readonly StoreTemplateKey[]

export type StoreTemplateDocumentKey = `template:${StoreTemplateKey}`

export function isStoreTemplateKey(value: unknown): value is StoreTemplateKey {
  return typeof value === 'string' && (STORE_TEMPLATE_KEYS as readonly string[]).includes(value)
}

/** `template:shop` → `shop`; anything else → null. */
export function templateKeyOf(documentKey: string): StoreTemplateKey | null {
  if (!documentKey.startsWith('template:')) return null
  const key = documentKey.slice('template:'.length)
  return isStoreTemplateKey(key) ? key : null
}

/** bootstrap `builder.templates`: which store page templates are published (staff `?preview=draft`: which have a draft). Absent key = false. */
export type BootstrapTemplates = Partial<Record<StoreTemplateKey, boolean>>

/** The element each template must hold exactly once (its "main part"). */
export const TEMPLATE_CORE_ELEMENT = {
  shop: 'product_listing',
  category: 'product_listing',
  brand: 'product_listing',
  search: 'product_listing',
  blog_post: 'blog_post_body',
  order: 'order_summary',
  not_found: 'not_found_message',
} as const satisfies Record<StoreTemplateKey, TemplateElementType>

/* ----------------------------------------------------------------------------------------------
 * The page context: what a store page knows about itself. Built in the browser by the store
 * route from the data it already loads (category, brand, listing, post, order, bootstrap store);
 * the editor gets the same shape from GET /storefront/builder/sample-context (order masked).
 * Money is a decimal string, dates are ISO 8601; null = unknown / not set.
 * -------------------------------------------------------------------------------------------- */

export type PageContextStore = { name: string; phone: string | null; email: string | null; address: string | null }

export type PageContextCategory = {
  id: string
  slug: string
  name: string
  /** Plain text (the category's HTML description without tags). */
  description: string | null
  /** Live products in the category (null until the listing answered). */
  product_count: number | null
}

/** `id`: null on the store (the public brand API has no id); the editor's sample has it. */
export type PageContextBrand = { id: string | null; slug: string; name: string; description: string | null; product_count: number | null }

export type PageContextSearch = { query: string; result_count: number | null }

export type PageContextPost = {
  /** Null on the store (the public blog API has no id); the editor's sample has it. */
  id: string | null
  slug: string
  title: string
  excerpt: string | null
  /** The author's first name. */
  author: string | null
  published_at: string
  /** Minutes. */
  reading_time: number | null
  /** The post's category name. */
  category: string | null
}

export type PageContextOrder = {
  number: string
  /** The status in the visitor's language ("Confirmed"). */
  status: string
  /** Decimal string ("1250.00"). */
  total: string
  currency: string | null
  placed_at: string
  customer_first_name: string | null
  /** The payment method's label ("Cash on delivery"). */
  payment_method: string
  /** Delivery estimate in days; null = no estimate. */
  delivery_eta: { min_days: number | null; max_days: number | null } | null
  /** Editor only: true = a made-up sample order (no real order behind it). */
  sample?: boolean
}

export type StorePageContext = {
  /** null = a normal page (only `store.*` fields). */
  template: StoreTemplateKey | null
  store: PageContextStore
  category?: PageContextCategory | null
  brand?: PageContextBrand | null
  search?: PageContextSearch | null
  post?: PageContextPost | null
  order?: PageContextOrder | null
}

/**
 * The full data a template's main part draws in the editor canvas (which fetches nothing): the
 * store's own API shapes, so the same components draw them. All optional; a missing one is drawn
 * as a neutral outline.
 */
export type StorePageSample = {
  /**
   * The sample's listing (first page): the raw GET /store/products answer (`data`, `meta`,
   * `facets`, `context`) as the backend's sample-context returns it, or an already normalized
   * ProductListing. Read with readSampleListing (./sample.ts).
   */
  listing?: ProductListing | RawListingAnswer | null
  /** GET /store/blog/{slug} answer. */
  post?: BlogPostDetail | null
  /** A masked order (recent order or fake sample), OrderView shape. */
  order?: OrderView | null
}

/** The /store/products answer as it comes over the wire (cards in `data`, paging in `meta`). */
export type RawListingAnswer = { data: unknown[]; meta?: Record<string, unknown>; facets?: unknown; context?: unknown }

/** GET /storefront/builder/sample-context?template=&id=&lang= (`choices`: order samples only — the editor's picker). */
export type SampleContextResponse = { context: StorePageContext; sample?: StorePageSample | null; choices?: unknown }

/* ----------------------------------------------------------------------------------------------
 * dynamic_text fields
 * -------------------------------------------------------------------------------------------- */

export const STORE_FIELDS = ['store.name', 'store.phone', 'store.email', 'store.address'] as const

/** The fields each template offers besides `store.*` (a normal page offers `store.*` only). */
export const TEMPLATE_FIELDS = {
  shop: [],
  category: ['category.name', 'category.description', 'category.product_count'],
  brand: ['brand.name', 'brand.description', 'brand.product_count'],
  search: ['search.query', 'search.result_count'],
  blog_post: ['post.title', 'post.excerpt', 'post.author', 'post.published_at', 'post.reading_time', 'post.category'],
  order: ['order.number', 'order.status', 'order.total', 'order.placed_at', 'order.customer_first_name', 'order.payment_method', 'order.delivery_eta'],
  not_found: [],
} as const satisfies Record<StoreTemplateKey, readonly string[]>

export type DynamicTextField = (typeof STORE_FIELDS)[number] | (typeof TEMPLATE_FIELDS)[StoreTemplateKey][number]

/** The fields a document may use: its template's plus `store.*`. */
export function fieldsFor(template: StoreTemplateKey | null): readonly DynamicTextField[] {
  return template ? [...TEMPLATE_FIELDS[template], ...STORE_FIELDS] : STORE_FIELDS
}

/* ----------------------------------------------------------------------------------------------
 * Element props (✱ translatable). Normalizers / limits: ../validate.ts (B14 section).
 * -------------------------------------------------------------------------------------------- */

export type TemplateElementType = 'dynamic_text' | 'product_listing' | 'blog_post_body' | 'order_summary' | 'not_found_message'

export type DynamicTextTag = 'p' | 'h1' | 'h2' | 'h3' | 'span'
export type DynamicTextFormat = 'default' | 'money' | 'number' | 'date'

export type DynamicTextProps = {
  field: DynamicTextField
  tag: DynamicTextTag
  /** ✱ ≤ 80 each. */
  prefix: string
  suffix: string
  /** ✱ ≤ 200: shown when the field has no value (empty = the element is left out). */
  fallback: string
  format: DynamicTextFormat
}

export type ProductListingScope = 'current' | 'all' | 'categories' | 'brands' | 'on_sale' | 'new_arrivals'

export type ProductListingFilters = {
  price: boolean
  brand: boolean
  category: boolean
  attributes: boolean
  availability: boolean
  on_sale: boolean
}

export type ProductListingProps = {
  /** `current` = the template's own listing (listing templates only); the others on normal pages. Default `all`. */
  scope: ProductListingScope
  /** scope `categories` / `brands`: 1–20 ids (the server resolves them to slugs in `data[id]`). */
  category_ids: string[]
  brand_ids: string[]
  filters: ProductListingFilters
  filter_layout: 'sidebar' | 'top' | 'drawer'
  sort_default: SortKey
  /** 12 | 24 | 36 | 48. */
  per_page: number
  /** desktop 3–5, tablet 2–4, mobile 1–2 (the theme's listing_columns ranges). */
  columns: { desktop: 3 | 4 | 5; tablet: 2 | 3 | 4; mobile: 1 | 2 }
  show_count: boolean
  pagination: 'pages' | 'load_more'
}

/** `data[id]` of a product_listing with scope categories / brands (only then): the live slugs, in order. */
export type ProductListingData = { category_slugs: string[]; brand_slugs: string[] }

export type BlogPostBodyProps = {
  show_cover: boolean
  show_meta: boolean
  show_share: boolean
  show_related: boolean
}

/** Totals, payment / cash-on-delivery details and "Pay now" are always shown. */
export type OrderSummaryProps = {
  show_timeline: boolean
  show_items: boolean
  show_address: boolean
  show_delivery: boolean
}

export type NotFoundMessageProps = {
  /** ✱ ≤ 120 (empty = "Page not found" in the visitor's language). */
  heading: string
  /** ✱ ≤ 400. */
  text: string
  show_search: boolean
  show_links: boolean
}
