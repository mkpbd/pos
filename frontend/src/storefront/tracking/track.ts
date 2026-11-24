import { loadPixels, type PixelIds } from './pixels'

/*
 * BD1c: the storefront's one way to report shopping events to the ad pixels: `track('add_to_cart',
 * {...})`. The store layout configures it from the bootstrap (pixel ids, never in a preview);
 * events sent before that wait in a short queue, and are dropped when the store has no pixels.
 * Purchase is sent once per order (sessionStorage), with the order number as the event id the
 * server's Conversions API uses too, so Meta counts it once. A failing pixel never breaks a page.
 */

export type TrackItem = { id: string; name: string; price: number; quantity: number }
export type CommerceData = { currency: string | null; value: number; items: TrackItem[] }

export type TrackEvents = {
  page_view: { path: string; title?: string }
  view_content: CommerceData
  add_to_cart: CommerceData
  begin_checkout: CommerceData
  purchase: CommerceData & { order_number: string }
}

export type TrackEventName = keyof TrackEvents

type Queued = { [E in TrackEventName]: { event: E; data: TrackEvents[E] } }[TrackEventName]

type State = { status: 'pending'; queue: Queued[] } | { status: 'off' } | { status: 'on'; ids: PixelIds }

const MAX_QUEUE = 30
const PURCHASE_PREFIX = 'sf:pixel-purchase:'

let state: State = { status: 'pending', queue: [] }
const purchasedHere = new Set<string>()

/**
 * Turns the pixels on (ids) or off (null: no pixels, or a staff preview). `firstPageView` is sent
 * before the events that waited for the configuration.
 */
export function configureTracking(ids: PixelIds | null, firstPageView?: TrackEvents['page_view']): void {
  const waiting = state.status === 'pending' ? state.queue : []
  if (!ids) {
    state = { status: 'off' }
    return
  }
  let ready: PixelIds
  try {
    ready = loadPixels(ids)
  } catch {
    state = { status: 'off' }
    return
  }
  if (!ready.meta && !ready.ga4 && !ready.tiktok) {
    state = { status: 'off' }
    return
  }
  state = { status: 'on', ids: ready }
  if (firstPageView) dispatch({ event: 'page_view', data: firstPageView })
  for (const item of waiting) dispatch(item)
}

/** Whether the pixels are on (configured with at least one id). */
export function trackingActive(): boolean {
  return state.status === 'on'
}

/** Reports an event to every configured pixel. */
export function track<E extends TrackEventName>(event: E, data: TrackEvents[E]): void {
  const item = { event, data } as Queued
  if (state.status === 'off') return
  if (state.status === 'pending') {
    if (state.queue.length < MAX_QUEUE) state.queue.push(item)
    return
  }
  dispatch(item)
}

/** Tests only: back to "not configured yet". */
export function resetTrackingForTests(): void {
  state = { status: 'pending', queue: [] }
  purchasedHere.clear()
}

/** True the first time an order's purchase is reported in this tab (and remembers it). */
function firstPurchase(number: string): boolean {
  if (purchasedHere.has(number)) return false
  purchasedHere.add(number)
  try {
    if (sessionStorage.getItem(PURCHASE_PREFIX + number)) return false
    sessionStorage.setItem(PURCHASE_PREFIX + number, '1')
  } catch {
    // Storage blocked: once per page load.
  }
  return true
}

function dispatch(item: Queued): void {
  if (state.status !== 'on') return
  const ids = state.ids
  if (item.event === 'purchase' && !firstPurchase(item.data.order_number)) return
  if (ids.meta) safely(() => sendMeta(item))
  if (ids.ga4) safely(() => sendGa4(item))
  if (ids.tiktok) safely(() => sendTikTok(item))
}

function safely(send: () => void): void {
  try {
    send()
  } catch {
    // A pixel that fails (blocked script, broken stub) never breaks the page.
  }
}

const round = (value: number) => (Number.isFinite(value) ? Math.round(value * 100) / 100 : 0)

function withCurrency<T extends Record<string, unknown>>(data: CommerceData, body: T): T & { currency?: string } {
  return data.currency ? { ...body, currency: data.currency } : body
}

/* Meta: PageView, ViewContent, AddToCart, InitiateCheckout, Purchase (eventID = order number). */
const META_EVENTS = { view_content: 'ViewContent', add_to_cart: 'AddToCart', begin_checkout: 'InitiateCheckout', purchase: 'Purchase' } as const

function metaBody(data: CommerceData) {
  return withCurrency(data, {
    content_ids: data.items.map((item) => item.id),
    content_type: 'product',
    contents: data.items.map((item) => ({ id: item.id, quantity: item.quantity, item_price: round(item.price) })),
    num_items: data.items.reduce((sum, item) => sum + item.quantity, 0),
    value: round(data.value),
  })
}

function sendMeta(item: Queued): void {
  const fbq = window.fbq
  if (!fbq) return
  if (item.event === 'page_view') return fbq('track', 'PageView')
  const body = metaBody(item.data)
  if (item.event === 'purchase') return fbq('track', 'Purchase', { ...body, order_id: item.data.order_number }, { eventID: item.data.order_number })
  if (item.event === 'view_content') return fbq('track', META_EVENTS[item.event], { ...body, content_name: item.data.items[0]?.name })
  fbq('track', META_EVENTS[item.event], body)
}

/* GA4: page_view, view_item, add_to_cart, begin_checkout, purchase (transaction_id = order number). */
const GA4_EVENTS = { view_content: 'view_item', add_to_cart: 'add_to_cart', begin_checkout: 'begin_checkout', purchase: 'purchase' } as const

function sendGa4(item: Queued): void {
  const gtag = window.gtag
  if (!gtag) return
  if (item.event === 'page_view') {
    return gtag('event', 'page_view', { page_location: window.location.href, page_path: item.data.path, page_title: item.data.title ?? document.title })
  }
  const body = withCurrency(item.data, {
    value: round(item.data.value),
    items: item.data.items.map((line) => ({ item_id: line.id, item_name: line.name, price: round(line.price), quantity: line.quantity })),
  })
  if (item.event === 'purchase') return gtag('event', 'purchase', { ...body, transaction_id: item.data.order_number })
  gtag('event', GA4_EVENTS[item.event], body)
}

/* TikTok: page(), ViewContent, AddToCart, InitiateCheckout, CompletePayment (event_id = order number). */
const TIKTOK_EVENTS = { view_content: 'ViewContent', add_to_cart: 'AddToCart', begin_checkout: 'InitiateCheckout', purchase: 'CompletePayment' } as const

function sendTikTok(item: Queued): void {
  const ttq = window.ttq
  if (!ttq) return
  if (item.event === 'page_view') {
    if (typeof ttq.page === 'function') ttq.page()
    return
  }
  if (typeof ttq.track !== 'function') return
  const body = withCurrency(item.data, {
    contents: item.data.items.map((line) => ({ content_id: line.id, content_type: 'product', content_name: line.name, quantity: line.quantity, price: round(line.price) })),
    value: round(item.data.value),
  })
  if (item.event === 'purchase') return ttq.track(TIKTOK_EVENTS.purchase, body, { event_id: item.data.order_number })
  ttq.track(TIKTOK_EVENTS[item.event], body)
}
