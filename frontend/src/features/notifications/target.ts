/** In-app path of a notification (`url`, or `link` on older alerts); anything but a same-origin path is ignored. */
export function notificationTarget(data: { link?: unknown; url?: unknown }): string | null {
  const target = data.url ?? data.link
  return typeof target === 'string' && target.startsWith('/') && !target.startsWith('//') ? target : null
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '')

/**
 * R1: extra lines some alerts carry — the first batches of an expiry alert (`items`) and the
 * best sellers of the daily summary (`top_products`). Anything else shows title and message only.
 */
export function notificationLines(data: Obj): string[] {
  if (Array.isArray(data.items)) {
    return data.items.filter(isObj).slice(0, 5).map((i) => [text(i.product), text(i.batch) && `batch ${text(i.batch)}`, text(i.expires_on) && `expires ${text(i.expires_on)}`, text(i.quantity) && `qty ${trimQuantity(text(i.quantity))}`].filter(Boolean).join(' · '))
  }
  if (Array.isArray(data.top_products)) {
    const names = data.top_products.filter(isObj).slice(0, 3).map((p) => text(p.name)).filter(Boolean)
    return names.length > 0 ? [`Best sellers: ${names.join(', ')}`] : []
  }
  return []
}

/** "12.500" → "12.5", "3.000" → "3". */
function trimQuantity(value: string): string {
  return /^-?\d+\.\d+$/.test(value) ? value.replace(/\.?0+$/, '') : value
}
