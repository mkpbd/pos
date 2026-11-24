/*
 * BD1c: the ad pixels' standard loaders — Meta (fbq), Google Analytics 4 (gtag) and TikTok (ttq) —
 * written out as their vendors publish them: a queueing stub on window plus one async script tag
 * each. A stub already on the page (another snippet, or a test's recorder) is kept and used.
 * Each pixel id is initialised once per page load. Nothing here throws.
 */

export type PixelIds = { meta: string | null; ga4: string | null; tiktok: string | null }

type Fbq = ((...args: unknown[]) => void) & { callMethod?: (...args: unknown[]) => void; queue?: unknown[]; push?: unknown; loaded?: boolean; version?: string }
type Gtag = (...args: unknown[]) => void
type TikTokQueue = unknown[] & {
  methods?: string[]
  setAndDefer?: (target: Record<string, unknown>, method: string) => void
  instance?: (id: string) => unknown
  load?: (id: string, options?: Record<string, unknown>) => void
  page?: (...args: unknown[]) => void
  track?: (...args: unknown[]) => void
  _i?: Record<string, unknown[] & { _u?: string }>
  _t?: Record<string, number>
  _o?: Record<string, Record<string, unknown>>
}

declare global {
  interface Window {
    fbq?: Fbq
    _fbq?: Fbq
    dataLayer?: unknown[]
    gtag?: Gtag
    ttq?: TikTokQueue
    TiktokAnalyticsObject?: string
  }
}

/** Ids as the server validates them; anything else is ignored (it would end up in a script URL). */
const VALID = {
  meta: /^\d{10,20}$/,
  ga4: /^G-[A-Z0-9]{4,20}$/,
  tiktok: /^[A-Z0-9]{10,30}$/,
}

export function cleanPixelIds(raw: { meta_pixel_id?: string | null; ga4_measurement_id?: string | null; tiktok_pixel_id?: string | null } | null | undefined): PixelIds | null {
  if (!raw) return null
  const pick = (value: string | null | undefined, pattern: RegExp) => (typeof value === 'string' && pattern.test(value.trim()) ? value.trim() : null)
  const ids: PixelIds = { meta: pick(raw.meta_pixel_id, VALID.meta), ga4: pick(raw.ga4_measurement_id, VALID.ga4), tiktok: pick(raw.tiktok_pixel_id, VALID.tiktok) }
  return ids.meta || ids.ga4 || ids.tiktok ? ids : null
}

export const PIXEL_SCRIPTS = {
  meta: 'https://connect.facebook.net/en_US/fbevents.js',
  ga4: 'https://www.googletagmanager.com/gtag/js',
  tiktok: 'https://analytics.tiktok.com/i18n/pixel/events.js',
} as const

const initialised = new Set<string>()

function addScript(src: string, name: keyof typeof PIXEL_SCRIPTS): void {
  if (document.querySelector(`script[data-sf-pixel="${name}"]`)) return
  const script = document.createElement('script')
  script.async = true
  script.src = src
  script.dataset.sfPixel = name
  document.head.appendChild(script)
}

function loadMeta(id: string): void {
  if (!window.fbq) {
    const fbq: Fbq = (...args: unknown[]) => {
      if (fbq.callMethod) fbq.callMethod(...args)
      else fbq.queue!.push(args)
    }
    fbq.push = fbq
    fbq.loaded = true
    fbq.version = '2.0'
    fbq.queue = []
    window.fbq = fbq
    if (!window._fbq) window._fbq = fbq
    addScript(PIXEL_SCRIPTS.meta, 'meta')
  }
  window.fbq('init', id)
}

function loadGa4(id: string): void {
  if (!window.gtag) {
    window.dataLayer = window.dataLayer ?? []
    // Google's snippet: gtag.js reads the Arguments object itself, not an array.
    window.gtag = function gtag() {
      // oxlint-disable-next-line prefer-rest-params
      window.dataLayer!.push(arguments)
    }
    addScript(`${PIXEL_SCRIPTS.ga4}?id=${encodeURIComponent(id)}`, 'ga4')
    window.gtag('js', new Date())
  }
  // Page views are sent on every route change (a single-page app), not by the config call.
  window.gtag('config', id, { send_page_view: false })
}

const TIKTOK_METHODS = ['page', 'track', 'identify', 'instances', 'debug', 'on', 'off', 'once', 'ready', 'alias', 'group', 'enableCookie', 'disableCookie', 'holdConsent', 'revokeConsent', 'grantConsent']

function loadTikTok(id: string): void {
  if (!window.ttq) {
    window.TiktokAnalyticsObject = 'ttq'
    const ttq = [] as unknown as TikTokQueue
    ttq.methods = TIKTOK_METHODS
    ttq.setAndDefer = (target, method) => {
      target[method] = (...args: unknown[]) => (target as unknown as unknown[]).push([method, ...args])
    }
    for (const method of TIKTOK_METHODS) ttq.setAndDefer(ttq as unknown as Record<string, unknown>, method)
    ttq.instance = (instanceId: string) => {
      const target = (ttq._i?.[instanceId] ?? []) as unknown as Record<string, unknown>
      for (const method of TIKTOK_METHODS) ttq.setAndDefer!(target, method)
      return target
    }
    ttq.load = (sdkId: string, options?: Record<string, unknown>) => {
      ttq._i = ttq._i ?? {}
      ttq._i[sdkId] = [] as unknown[] & { _u?: string }
      ttq._i[sdkId]._u = PIXEL_SCRIPTS.tiktok
      ttq._t = ttq._t ?? {}
      ttq._t[sdkId] = Date.now()
      ttq._o = ttq._o ?? {}
      ttq._o[sdkId] = options ?? {}
      addScript(`${PIXEL_SCRIPTS.tiktok}?sdkid=${encodeURIComponent(sdkId)}&lib=ttq`, 'tiktok')
    }
    window.ttq = ttq
  }
  if (typeof window.ttq.load === 'function') window.ttq.load(id)
}

/** Loads each configured pixel once (script tag + init). Returns which pixels are usable. */
export function loadPixels(ids: PixelIds): PixelIds {
  const ready: PixelIds = { meta: null, ga4: null, tiktok: null }
  const steps: [keyof PixelIds, (id: string) => void][] = [
    ['meta', loadMeta],
    ['ga4', loadGa4],
    ['tiktok', loadTikTok],
  ]
  for (const [name, load] of steps) {
    const id = ids[name]
    if (!id) continue
    try {
      if (!initialised.has(`${name}:${id}`)) {
        load(id)
        initialised.add(`${name}:${id}`)
      }
      ready[name] = id
    } catch {
      // A broken pixel never breaks the store.
    }
  }
  return ready
}

/** Tests only: forget which pixels were initialised. */
export function resetPixelsForTests(): void {
  initialised.clear()
}
