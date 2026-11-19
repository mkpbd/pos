import type { Translate } from '../../i18n/translate'
import type { BlogPostRow, OrderView, StoreBrand, StoreCategory, StorefrontBootstrap } from '../../types'
import { readingTimeLabel } from '../../blog/display'
import { etaLabel } from '../../checkout/delivery'
import { formatPrice } from '../../money'
import {
  fieldsFor,
  isStoreTemplateKey,
  type DynamicTextField,
  type DynamicTextFormat,
  type PageContextOrder,
  type PageContextPost,
  type StorePageContext,
  type StoreTemplateKey,
} from './types'

/*
 * B14: building a store page's context from the data its route already loads, and reading a
 * dynamic_text field from it. Pure (no React), shared by the store routes and the editor canvas.
 */

/** The first `max` characters of an HTML fragment as plain text (null when empty). */
export function plainTextOf(html: string | null | undefined, max = 500): string | null {
  if (!html) return null
  const text = (new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return null
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

const firstName = (name: string | null | undefined) => (name ?? '').trim().split(/\s+/)[0] || null

/** The store part every context has (name and the footer contact details). */
export function storeContext(bootstrap: Pick<StorefrontBootstrap, 'store' | 'theme'>): StorePageContext['store'] {
  const contact = bootstrap.theme?.footer?.contact
  return { name: bootstrap.store.name, phone: contact?.phone || null, email: contact?.email || null, address: contact?.address || null }
}

export function categoryContext(category: StoreCategory, productCount: number | null): NonNullable<StorePageContext['category']> {
  return { id: category.id, slug: category.slug, name: category.name, description: plainTextOf(category.description_html), product_count: productCount }
}

export function brandContext(brand: StoreBrand, productCount: number | null): NonNullable<StorePageContext['brand']> {
  return { id: null, slug: brand.slug, name: brand.name, description: brand.description?.trim() || null, product_count: productCount }
}

export function postContext(post: BlogPostRow): PageContextPost {
  return {
    id: null,
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    author: post.author,
    published_at: post.published_at,
    reading_time: Number.isFinite(post.reading_minutes) ? post.reading_minutes : null,
    category: post.category?.name ?? null,
  }
}

/** `status`: the status in the visitor's language (orderStatusLabel). */
export function orderContext(order: OrderView, status: string): PageContextOrder {
  return {
    number: order.number,
    status,
    total: order.total,
    currency: order.currency,
    placed_at: order.placed_at,
    customer_first_name: firstName(order.contact?.name),
    payment_method: order.payment_method_label,
    delivery_eta: order.eta_min_days === null && order.eta_max_days === null ? null : { min_days: order.eta_min_days, max_days: order.eta_max_days },
  }
}

/** A field's raw value in a context: a string, a number, an ETA, or null (unknown, empty or not this page's field). */
export function fieldValue(context: StorePageContext | null, field: string): string | number | { min_days: number | null; max_days: number | null } | null {
  if (!context) return null
  const template = isStoreTemplateKey(context.template) ? context.template : null
  if (!(fieldsFor(template) as readonly string[]).includes(field)) return null
  const [source, key] = field.split('.') as [string, string]
  const record = (context as Record<string, unknown>)[source]
  if (typeof record !== 'object' || record === null) return null
  const value = (record as Record<string, unknown>)[key]
  if (typeof value === 'string') return value.trim() === '' ? null : value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (key === 'delivery_eta' && typeof value === 'object' && value !== null) return value as { min_days: number | null; max_days: number | null }
  return null
}

const DECIMAL = /^-?\d+(\.\d+)?$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/

export type FieldFormatters = {
  t: Translate
  formatNumber: (value: number | string) => string
  formatDate: (iso: string) => string
  digits: (text: string) => string
}

/**
 * The text a dynamic_text shows for a field (without prefix / suffix), or null. `default` picks
 * the field's natural format (money for the order total, dates for dates, numbers for counts);
 * an explicit format applies only where the value fits it.
 */
export function fieldText(
  context: StorePageContext | null,
  field: DynamicTextField | string,
  format: DynamicTextFormat,
  f: FieldFormatters,
  currency: string | null | undefined,
): string | null {
  const value = fieldValue(context, field)
  if (value === null) return null
  if (typeof value === 'object') return etaLabel(value.min_days, value.max_days, f.t)
  if (field === 'post.reading_time' && typeof value === 'number' && format === 'default') return readingTimeLabel(value, f.t)
  const natural: DynamicTextFormat =
    format !== 'default' ? format : field === 'order.total' ? 'money' : field.endsWith('_at') ? 'date' : typeof value === 'number' ? 'number' : 'default'
  const raw = String(value)
  if (natural === 'money' && DECIMAL.test(raw)) return formatPrice(raw, field === 'order.total' ? (context?.order?.currency ?? currency) : currency)
  if (natural === 'number' && DECIMAL.test(raw)) return f.formatNumber(raw)
  if (natural === 'date' && typeof value === 'string' && ISO_DATE.test(value)) return f.formatDate(value)
  return typeof value === 'number' ? f.digits(raw) : raw
}

/** The template a document key draws (`template:category` → category), else null. */
export function contextTemplate(context: StorePageContext | null): StoreTemplateKey | null {
  return context && isStoreTemplateKey(context.template) ? context.template : null
}

/** Opening marks a prefix may end with (no space after them). */
const OPENING = /["“‘([]$/
/** Closing punctuation a suffix may start with (no space before it). */
const CLOSING = /^["”’)\]!?.,;:।]/

/**
 * The text of a dynamic_text: prefix, value and suffix joined with one space between non-empty
 * parts — no space after a prefix ending in an opening mark, none before a suffix starting with
 * closing punctuation (the server trims both). No value: the fallback alone, or null (left out).
 * "ধন্যবাদ," + "Rahim" + "!" → "ধন্যবাদ, Rahim!"; "খোঁজার ফল: “" + "tea" + "”" → "খোঁজার ফল: “tea”".
 */
export function formatDynamicText(prefix: string, value: string | null, suffix: string, fallback: string): string | null {
  const text = value?.trim() ?? ''
  if (!text) return fallback.trim() || null
  const before = prefix.trim()
  const after = suffix.trim()
  let out = before ? (OPENING.test(before) ? `${before}${text}` : `${before} ${text}`) : text
  if (after) out = CLOSING.test(after) ? `${out}${after}` : `${out} ${after}`
  return out
}
