import { compareDecimal } from '@/lib/money'
import type { DeliveryPromiseData, PaymentWallet } from '../types'
import { B17_ENUMS, isMoneyString, isUuid, oneOf } from '../validate'
import { isObject, str } from './shared'

/*
 * B17, pure: what the payment badges and the delivery promise show, read defensively from the
 * payload (the renderer never trusts its shape) with the element's show_* switches applied.
 */

/** Wallet names when the payload has none for a code (the editor canvas before its data arrives). Plain text, never logos. */
export const WALLET_NAMES: Record<PaymentWallet, { en: string; bn: string }> = {
  bkash: { en: 'bKash', bn: 'বিকাশ' },
  nagad: { en: 'Nagad', bn: 'নগদ' },
  rocket: { en: 'Rocket', bn: 'রকেট' },
  upay: { en: 'Upay', bn: 'উপায়' },
}

export type PaymentBadge = { kind: 'store' | 'wallet'; code: string; name: string }

function namedEntries(value: unknown): { code: string; name: string }[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(isObject)
    .map((entry) => ({ code: str(entry.code), name: str(entry.name).trim().slice(0, 80) }))
    .filter((entry) => entry.code !== '' && entry.name !== '')
}

/**
 * The badges to draw: the store's checkout methods (when the element shows them), then the
 * chosen wallets in the owner's order (props win over the payload so the canvas follows edits;
 * names from the payload, else the built-in ones).
 */
export function paymentBadges(props: { show_store_methods?: unknown; wallets?: unknown }, data: unknown, locale: 'en' | 'bn'): PaymentBadge[] {
  const payload = isObject(data) ? data : {}
  const methods = props.show_store_methods === false ? [] : namedEntries(payload.methods).map((m): PaymentBadge => ({ kind: 'store', ...m }))
  const names = new Map(namedEntries(payload.wallets).map((w) => [w.code, w.name]))
  const seen = new Set<string>()
  const wallets: PaymentBadge[] = []
  for (const code of Array.isArray(props.wallets) ? props.wallets : []) {
    const wallet = oneOf(code, B17_ENUMS.paymentWallet)
    if (!wallet || seen.has(wallet)) continue
    seen.add(wallet)
    wallets.push({ kind: 'wallet', code: wallet, name: names.get(wallet) ?? WALLET_NAMES[wallet][locale] })
  }
  return [...methods, ...wallets]
}

/* -------------------------------------------------------------------------------------------- */

export type DeliveryLine = {
  id: string
  name: string
  method: string | null
  min: number
  max: number
  /** A fixed fee ("0" = free), or null with `from` set: the zone's methods differ. Null both when prices are hidden. */
  fee: string | null
  from: string | null
  /** This zone takes cash on delivery (only when shown and not already said for everywhere). */
  cod: boolean
  /** This zone's free-delivery threshold (only when shown and there is no store-wide one). */
  freeOver: string | null
}

export type DeliverySummary = {
  lines: DeliveryLine[]
  /** "Cash on delivery everywhere". */
  codEverywhere: boolean
  /** "Free delivery over …" for every zone. */
  freeOver: string | null
}

const money = (value: unknown): string | null => (isMoneyString(value) ? value : null)
const days = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 365 ? value : null)

/** The delivery promise's lines from its data and switches; null when there is nothing to say. */
export function deliverySummary(props: { show_price?: unknown; show_cod?: unknown; show_free_over?: unknown }, data: DeliveryPromiseData): DeliverySummary | null {
  const showPrice = props.show_price !== false
  const showCod = props.show_cod !== false
  const showFree = props.show_free_over !== false
  const codEverywhere = showCod && data.cod_everywhere === true
  const freeOver = showFree ? money(data.free_over) : null
  const lines: DeliveryLine[] = []
  for (const zone of Array.isArray(data.zones) ? data.zones.slice(0, 50) : []) {
    if (!isObject(zone)) continue
    const name = str(zone.name).trim()
    const min = days(zone.min_days)
    const max = days(zone.max_days)
    if (!name || min === null || max === null || typeof zone.id !== 'string') continue
    const fee = money(zone.fee)
    const from = fee === null ? money(zone.fee_from) : null
    lines.push({
      id: isUuid(zone.id) ? zone.id : `zone-${lines.length}`,
      name,
      method: str(zone.method).trim() || null,
      min: Math.min(min, max),
      max: Math.max(min, max),
      fee: showPrice ? fee : null,
      from: showPrice ? from : null,
      cod: showCod && !codEverywhere && zone.cod_allowed === true,
      freeOver: showFree && !freeOver ? money(zone.free_over) : null,
    })
  }
  if (lines.length === 0) return null
  return { lines, codEverywhere, freeOver }
}

/** A fee of zero (delivery is free). */
export function isFree(amount: string): boolean {
  return compareDecimal(amount, '0') === 0
}
