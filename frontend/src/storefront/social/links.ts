import type { BuilderPage, RenderColumn } from '../builder/types'
import type { Translate } from '../i18n/translate'
import type { StorefrontBootstrap } from '../types'

/*
 * P2b sharing and WhatsApp: the links the share bar, "Order on WhatsApp" and the chat button open.
 * A shared or sent store link carries `utm_source=<network>&utm_medium=share|chat` (P2a attribution
 * picks them up when someone opens it); the visitor's own campaign tags, short-link code and ad
 * click ids never travel on.
 */

type StoreSettings = StorefrontBootstrap['store']

/** The ways to share: networks, plus the phone's share sheet and "Copy link". */
export type ShareNetwork = 'facebook' | 'messenger' | 'whatsapp' | 'x' | 'pinterest'
export type ShareChannel = ShareNetwork | 'copy' | 'native'

export const SHARE_MEDIUM = 'share'
export const CHAT_MEDIUM = 'chat'

/** `utm_source` per way of sharing. */
export const SHARE_SOURCE: Record<ShareChannel, string> = {
  facebook: 'facebook',
  messenger: 'messenger',
  whatsapp: 'whatsapp',
  x: 'x',
  pinterest: 'pinterest',
  copy: 'copy_link',
  native: 'native_share',
}

/** Query parameters a passed-on link drops: campaign tags, the short-link code, ad click ids, previews and access tokens. */
const DROPPED_PARAM = /^(utm_\w+|sl|fbclid|gclid|gbraid|wbraid|msclkid|ttclid|twclid|preview|token)$/i

function origin(): string {
  return typeof window === 'undefined' ? 'http://localhost' : window.location.origin
}

/** A store path made absolute on this host (absolute URLs stay as they are); null when it cannot be one. */
export function absoluteUrl(pathOrUrl: string | null | undefined): string | null {
  if (!pathOrUrl) return null
  try {
    const url = new URL(pathOrUrl, origin())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

/** The link tagged for its source and medium; earlier tags, click ids, previews, tokens and the fragment removed. */
export function taggedLink(href: string, source: string, medium: string): string {
  let url: URL
  try {
    url = new URL(href, origin())
  } catch {
    return href
  }
  for (const key of [...url.searchParams.keys()]) if (DROPPED_PARAM.test(key)) url.searchParams.delete(key)
  url.searchParams.set('utm_source', source)
  url.searchParams.set('utm_medium', medium)
  url.hash = ''
  return url.href
}

/** `a=1&b=2` with every value percent-encoded (spaces as %20: wa.me shows "+" literally). */
function query(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&')
}

/** What is shared: the page's address (canonical, absolute), its title and, for Pinterest, its picture. */
export type ShareTarget = { url: string; title: string; image?: string | null }

/** The address a network's share dialog (or app) opens with this page. */
export function shareHref(network: ShareNetwork, target: ShareTarget): string {
  const link = taggedLink(target.url, SHARE_SOURCE[network], SHARE_MEDIUM)
  switch (network) {
    case 'facebook':
      return `https://www.facebook.com/sharer/sharer.php?${query({ u: link })}`
    case 'messenger':
      // The Messenger app's own scheme: phones only.
      return `fb-messenger://share?${query({ link })}`
    case 'whatsapp':
      return `https://wa.me/?${query({ text: `${target.title}\n${link}` })}`
    case 'x':
      return `https://x.com/intent/tweet?${query({ text: target.title, url: link })}`
    case 'pinterest':
      return `https://www.pinterest.com/pin/create/button/?${query({ url: link, media: absoluteUrl(target.image) ?? '', description: target.title })}`
  }
}

/* ---------------------------------------------------------------------------------------------
 * Store settings (bootstrap `store`)
 * ------------------------------------------------------------------------------------------- */

/** Share bars show unless the owner turned them off (absent = on). */
export function shareButtonsEnabled(store: StoreSettings): boolean {
  return store.share_buttons !== false
}

/**
 * A wa.me number: the international number in digits, without "+" or leading zeros (E.164, 8–15
 * digits). A Bangladeshi mobile number typed the local way (01XXXXXXXXX) gets its 880 prefix.
 * Null when it cannot be one.
 */
export function waNumber(value: unknown): string | null {
  if (typeof value !== 'string') return null
  let digits = value.trim().replace(/[\s().-]/g, '').replace(/^\+/, '')
  if (/^01[3-9]\d{8}$/.test(digits)) digits = `88${digits}`
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null
}

/** The number "Order on WhatsApp" sends to; null when the button is off (the flag is false without a number). */
export function whatsAppOrderNumber(store: StoreSettings): string | null {
  return store.whatsapp_order_button === true ? waNumber(store.whatsapp_number) : null
}

/** The number the floating chat button opens; null when it is off. */
export function whatsAppChatNumber(store: StoreSettings): string | null {
  return store.whatsapp_chat_button === true ? waNumber(store.whatsapp_number) : null
}

/** A chat with the store on WhatsApp, the message typed in already. */
export function waChatLink(number: string, text: string): string {
  return `https://wa.me/${number}?${query({ text })}`
}

/* ---------------------------------------------------------------------------------------------
 * Messages (in the shopper's language)
 * ------------------------------------------------------------------------------------------- */

export type OrderMessageParts = {
  name: string
  /** The chosen variant ("Red / M"); null for a product without options. */
  option: string | null
  /** Formatted for the shopper's language. */
  quantity: string
  /** The unit price, formatted. */
  price: string
  /** More than one unit: the price is per unit. */
  each: boolean
  /** The product's link (variant + tags). */
  link: string
}

/** "Hello! I would like to order:" with the product, option, quantity, price and link, one per line. */
export function orderMessage(t: Translate, parts: OrderMessageParts): string {
  return [
    t('social.whatsapp.message.order'),
    t('social.whatsapp.message.product', { name: parts.name }),
    parts.option ? t('social.whatsapp.message.option', { option: parts.option }) : null,
    t('social.whatsapp.message.quantity', { quantity: parts.quantity }),
    t(parts.each ? 'social.whatsapp.message.priceEach' : 'social.whatsapp.message.price', { price: parts.price }),
    parts.link,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n')
}

/** The parameters that say what a page shows; the chat message keeps only these. */
const PAGE_PARAMS = ['variant', 'q', 'page', 'lang'] as const

/** The page the shopper is on, for the chat message: its path plus what it shows, tagged for the chat. */
export function chatPageLink(location: { pathname: string; search: string }): string {
  const url = new URL(location.pathname, origin())
  const params = new URLSearchParams(location.search)
  for (const key of PAGE_PARAMS) {
    const value = params.get(key)
    if (value) url.searchParams.set(key, value)
  }
  return taggedLink(url.href, 'whatsapp', CHAT_MEDIUM)
}

/* ---------------------------------------------------------------------------------------------
 * A builder page's picture (Pinterest, the share preview)
 * ------------------------------------------------------------------------------------------- */

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The first `media_id` in an element's props that the page's media resolves (depth first, in order). */
function firstMediaId(value: unknown, media: Record<string, unknown>, depth = 0): string | null {
  if (depth > 5) return null
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstMediaId(item, media, depth + 1)
      if (found) return found
    }
    return null
  }
  if (!isRecord(value)) return null
  for (const [key, item] of Object.entries(value)) {
    if (key === 'media_id' && typeof item === 'string' && Object.hasOwn(media, item)) return item
    const found = firstMediaId(item, media, depth + 1)
    if (found) return found
  }
  return null
}

/** The picture of a product an element's data carries (the order form's product). */
function productImageOf(data: unknown): string | null {
  if (!isRecord(data) || !isRecord(data.product) || !Array.isArray(data.product.images)) return null
  const first: unknown = data.product.images[0]
  return isRecord(first) && typeof first.url === 'string' ? first.url : null
}

/**
 * The first picture visitors see on a builder page: the first image of a visible element in
 * document order (or the product of an order form), else any picture the page uses; null without one.
 */
export function firstPageImage(page: BuilderPage): string | null {
  const media = isRecord(page.media) ? page.media : {}
  const urlOf = (id: string) => {
    const item = media[id]
    return isRecord(item) && typeof item.url === 'string' ? item.url : null
  }
  const visit = (columns: RenderColumn[] | undefined): string | null => {
    for (const column of Array.isArray(columns) ? columns : []) {
      for (const element of Array.isArray(column.elements) ? column.elements : []) {
        if (element.hidden || element.state) continue
        if ('columns' in element && Array.isArray(element.columns)) {
          const found = visit(element.columns as RenderColumn[])
          if (found) return found
          continue
        }
        const id = firstMediaId(element.props, media)
        const url = (id && urlOf(id)) || productImageOf(isRecord(page.data) && Object.hasOwn(page.data, element.id) ? page.data[element.id] : null)
        if (url) return url
      }
    }
    return null
  }
  for (const section of Array.isArray(page.sections) ? page.sections : []) {
    if (section.hidden || section.state) continue
    const found = visit(section.columns)
    if (found) return found
  }
  for (const id of Object.keys(media)) {
    const url = urlOf(id)
    if (url) return url
  }
  return null
}
