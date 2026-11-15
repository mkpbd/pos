/*
 * B17 editor model (pure): plain-words option lists of the new elements (ornament, payment
 * badges, delivery promise, Bangla date), friendly messages for their prop problems, small list
 * helpers and the resolved data the forms read. Types, enums, limits and the rules themselves are
 * the storefront's (`@/storefront/builder/types`, `validate`); trust badges are the B6 element.
 */

import type { OrnamentProps, PaymentWallet, TrustBadgeItem } from '@/storefront/builder/types'
import { B17_ENUMS, B17_LIMITS, B17_TEXT_LIMITS, type PropProblem } from '@/storefront/builder/validate'

export const B17_TYPES: ReadonlySet<string> = new Set(['ornament', 'payment_badges', 'delivery_promise', 'bangla_date'])

/** The flag ribbon always uses the national flag's colours. */
export const FIXED_COLOR_ORNAMENTS: readonly string[] = ['flag_ribbon']

export const WALLET_NAMES: Record<PaymentWallet, { en: string; bn: string }> = {
  bkash: { en: 'bKash', bn: 'বিকাশ' },
  nagad: { en: 'Nagad', bn: 'নগদ' },
  rocket: { en: 'Rocket', bn: 'রকেট' },
  upay: { en: 'Upay', bn: 'উপায়' },
}

export const ALIGN_OPTIONS = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Centre' },
  { value: 'right', label: 'Right' },
] as const

export const ORNAMENT_FLIPS = [
  { value: 'none', label: 'As drawn' },
  { value: 'horizontal', label: 'Mirrored (left ↔ right)' },
  { value: 'vertical', label: 'Upside down' },
  { value: 'both', label: 'Mirrored and upside down' },
] as const

export const PAYMENT_STYLES = [
  { value: 'chips', label: 'Small badges in a row' },
  { value: 'list', label: 'A list, one per line' },
] as const

export const DELIVERY_LAYOUTS = [
  { value: 'cards', label: 'Cards side by side' },
  { value: 'list', label: 'A list' },
  { value: 'bar', label: 'One slim bar' },
] as const

export const BANGLA_DATE_STYLES = [
  { value: 'plain', label: 'Plain text' },
  { value: 'badge', label: 'Small badge' },
  { value: 'card', label: 'Card' },
] as const

/** Quick sizes (any size in range can be typed). */
export const ORNAMENT_SIZES = [
  { value: 32, label: 'Small' },
  { value: 64, label: 'Medium' },
  { value: 96, label: 'Large' },
  { value: 160, label: 'Extra large' },
] as const

/** Wallets in the fixed order (bKash, Nagad, Rocket, Upay), without duplicates or unknown keys. */
export function toggleWallet(wallets: readonly string[], wallet: PaymentWallet, on: boolean): PaymentWallet[] {
  const all = B17_ENUMS.paymentWallet as readonly PaymentWallet[]
  const set = new Set(wallets.filter((w): w is PaymentWallet => (all as readonly string[]).includes(w)))
  if (on) set.add(wallet)
  else set.delete(wallet)
  return all.filter((w) => set.has(w))
}

/** A zone ticked or unticked; switching from "all" starts an empty choice. */
export function toggleZone(zones: 'all' | string[], id: string, on: boolean): string[] {
  const list = zones === 'all' ? [] : zones.filter((z) => z !== id)
  return on ? [...list, id] : list
}

/** Props after choosing another drawing: repeat is dropped when the new one can't repeat. */
export function withOrnamentName(props: OrnamentProps, name: string, repeatable: readonly string[] = B17_ENUMS.ornamentRepeatable): OrnamentProps {
  return { ...props, name, repeat: props.repeat && repeatable.includes(name) }
}

/** The enum from GET /elements `enums[key]` when it is a string list, else the fallback. */
export function enumList(enums: Record<string, unknown> | undefined, key: string, fallback: readonly string[]): readonly string[] {
  const list = enums?.[key]
  return Array.isArray(list) && list.length > 0 && list.every((v) => typeof v === 'string') ? (list as string[]) : fallback
}

/** A trust badge with its link set, or the key removed (absent when unset). */
export function withBadgeLink<T extends TrustBadgeItem>(item: T, url: string | null): T {
  const { link: _drop, ...rest } = item
  return (url === null ? rest : { ...rest, link: { url } }) as T
}

/* ----------------------------------------------------------------------------------------------
 * Messages
 * -------------------------------------------------------------------------------------------- */

const REQUIRED: Record<string, string> = {
  'payment_badges.title': 'Enter the title, e.g. “How you can pay”.',
  'delivery_promise.title': 'Enter the title, e.g. “Delivery”.',
  'ornament.color': 'Choose a colour.',
  'ornament.name': 'Choose a drawing.',
}

/** A friendly message for a B17 prop problem (`b17PropProblems`). */
export function b17Message(type: string, problem: PropProblem): string {
  const { path, code } = problem
  const field = path.split('.')[0] ?? ''
  if (code === 'required') return REQUIRED[`${type}.${field}`] ?? 'This can’t be empty.'
  if (code === 'too_long') {
    const max = (B17_TEXT_LIMITS as Record<string, Record<string, number>>)[type]?.[field]
    return max ? `At most ${max} characters.` : 'This is too long.'
  }
  switch (`${type}.${field}`) {
    case 'ornament.name':
      return 'Choose a drawing.'
    case 'ornament.color':
    case 'ornament.secondary_color':
      return 'Use a colour such as #b45309 or a theme colour.'
    case 'ornament.size':
      return `Use a whole number from ${B17_LIMITS.ornamentSize.min} to ${B17_LIMITS.ornamentSize.max} px.`
    case 'ornament.opacity':
      return `Use ${B17_LIMITS.ornamentOpacity.min} % to ${B17_LIMITS.ornamentOpacity.max} %.`
    case 'ornament.repeat':
      return 'Only border drawings repeat across the width.'
    case 'payment_badges.wallets':
      return code === 'duplicate' ? 'A wallet is in the list twice.' : 'Choose wallets from the list.'
    case 'delivery_promise.zones':
      if (code === 'too_few') return 'Choose at least one delivery area, or “All delivery areas”.'
      if (code === 'too_many') return `Choose at most ${B17_LIMITS.deliveryZones.max} delivery areas, or “All delivery areas”.`
      return 'Choose delivery areas from the list.'
  }
  return code === 'invalid' && ['show_store_methods', 'show_price', 'show_cod', 'show_free_over', 'show_gregorian', 'show_hijri', 'repeat'].includes(field) ? 'This is on or off.' : 'Choose one of the options.'
}

/* ----------------------------------------------------------------------------------------------
 * Resolved data (POST /builder/resolve, drafts), read defensively; the canvas draws the real thing
 * -------------------------------------------------------------------------------------------- */

type Named = { code?: unknown; id?: unknown; name?: unknown }
const namesOf = (list: unknown): string[] => (Array.isArray(list) ? list.map((m) => (m as Named)?.name).filter((n): n is string => typeof n === 'string' && n !== '') : [])

export type ResolvedPayment = { empty: boolean; methods: string[] }

/** payment_badges data `{methods:[{code,name}], wallets:[{code,name}], state?}`. */
export function readPaymentData(data: unknown): ResolvedPayment {
  const body = (data ?? {}) as { state?: unknown; methods?: unknown; wallets?: unknown }
  const methods = namesOf(body.methods)
  return { empty: body.state === 'empty' || (methods.length === 0 && namesOf(body.wallets).length === 0), methods }
}

export type ZoneOption = { id: string; name: string }
export type ResolvedDelivery = { empty: boolean; allZones: ZoneOption[]; missing: string[]; shown: number }

/** delivery_promise data `{zones:[…], cod_everywhere, free_over, all_zones:[{id,name}], missing:[uuid], state?}`. */
export function readDeliveryData(data: unknown): ResolvedDelivery {
  const body = (data ?? {}) as { state?: unknown; zones?: unknown; all_zones?: unknown; missing?: unknown }
  const allZones = Array.isArray(body.all_zones)
    ? body.all_zones.filter((z): z is ZoneOption => typeof (z as Named)?.id === 'string' && typeof (z as Named)?.name === 'string').map((z) => ({ id: z.id, name: z.name }))
    : []
  const missing = Array.isArray(body.missing) ? body.missing.filter((id): id is string => typeof id === 'string') : []
  const shown = Array.isArray(body.zones) ? body.zones.length : 0
  return { empty: body.state === 'empty' || shown === 0, allZones, missing, shown }
}
