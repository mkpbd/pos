import { z } from 'zod'
import type { AreaInput, Courier, CourierInput, District, Division, MethodInput, ShippingArea, ShippingMethod, ShippingZone } from '@/features/shipping/api'
import { readBn, toTranslationsInput, translationsSchema, type TranslationsMap } from '@/features/translations/translations'
import { ApiError } from '@/lib/api/client'
import { formatMoney, MONEY_PATTERN, trimDecimal } from '@/lib/money'

export type DivisionGroup = { division: Division; districts: District[] }

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name)

/** Districts grouped under their division, both by English name; empty divisions are dropped. */
export function groupDistricts(divisions: Division[], districts: District[]): DivisionGroup[] {
  return [...divisions]
    .sort(byName)
    .map((division) => ({ division, districts: districts.filter((d) => d.division_id === division.id).sort(byName) }))
    .filter((g) => g.districts.length > 0)
}

/** District id → name of the (other) zone that already covers it. One zone per district. */
export function districtOwners(zones: ShippingZone[], exceptZoneId?: string): Map<number, string> {
  const owners = new Map<number, string>()
  for (const zone of zones) {
    if (zone.id === exceptZoneId) continue
    for (const d of zone.districts) owners.set(d.id, zone.name)
  }
  return owners
}

/** Toggling a whole division only touches districts no other zone owns. */
export function toggleDivision(selected: number[], group: DivisionGroup, owners: Map<number, string>, on: boolean): number[] {
  const ids = group.districts.filter((d) => !owners.has(d.id)).map((d) => d.id)
  const rest = selected.filter((id) => !ids.includes(id))
  return on ? [...rest, ...ids] : rest
}

/** Explains DISTRICT_IN_OTHER_ZONE, naming the districts when the server lists them. */
export function zoneSaveError(error: unknown, districts: District[]): string {
  if (!(error instanceof ApiError)) return error instanceof Error ? error.message : 'Something went wrong.'
  if (error.code !== 'DISTRICT_IN_OTHER_ZONE') return error.message
  const raw = error.details.district_ids ?? error.details.districts
  const ids = Array.isArray(raw) ? raw.map((x) => (typeof x === 'object' && x !== null && 'id' in x ? Number((x as { id: unknown }).id) : Number(x))) : []
  const names = ids.map((id) => districts.find((d) => d.id === id)?.name).filter((n): n is string => !!n)
  const base = 'Some districts already belong to another zone; the list was refreshed.'
  return names.length > 0 ? `${base} Remove ${names.join(', ')} or take them out of the other zone first.` : base
}

export function feeSummary(method: Pick<ShippingMethod, 'fee' | 'free_over'>, currency?: string): string {
  const fee = /^0+(\.0+)?$/.test(method.fee) ? 'Free' : formatMoney(method.fee, currency)
  return method.free_over ? `${fee} · free over ${formatMoney(method.free_over, currency)}` : fee
}

const money = (label: string) => z.string().trim().regex(MONEY_PATTERN, `${label}: a non-negative amount with at most 2 decimals.`)
const days = z.number({ error: 'Whole days, 0–30.' }).int('Whole days, 0–30.').min(0, 'Whole days, 0–30.').max(30, 'Whole days, 0–30.')

export const METHOD_NAME_MAX = 60
export const METHOD_DESCRIPTION_MAX = 160
/** Translatable method texts shown at checkout (E12b). */
const METHOD_TRANSLATIONS = [{ name: 'name', max: METHOD_NAME_MAX }, { name: 'description', max: METHOD_DESCRIPTION_MAX }] as const
const METHOD_TRANSLATION_NAMES = METHOD_TRANSLATIONS.map((f) => f.name)

export const methodSchema = z
  .object({
    name: z.string().trim().min(1, 'Required.').max(60),
    description: z.string().trim().max(160),
    fee: money('Fee'),
    free_over: z.union([z.literal(''), money('Free over')]),
    cod_allowed: z.boolean(),
    cod_fee: z.string().trim(),
    eta_min_days: days,
    eta_max_days: days,
    is_active: z.boolean(),
    sort_order: z.number({ error: 'A whole number.' }).int('A whole number.').min(0, 'A whole number.'),
    /** BD2a: weight pricing on/off, the kg the fee covers and the fee per extra kg. */
    weight_pricing: z.boolean(),
    weight_included_kg: z.string().trim(),
    fee_per_extra_kg: z.string().trim(),
    translations: translationsSchema(METHOD_TRANSLATIONS),
  })
  .refine((v) => v.eta_min_days <= v.eta_max_days, { path: ['eta_max_days'], message: 'At least the minimum.' })
  .refine((v) => !v.weight_pricing || KG_PATTERN.test(v.weight_included_kg), { path: ['weight_included_kg'], message: 'Kilograms, up to 3 decimals (0 or more).' })
  .refine((v) => !v.weight_pricing || MONEY_PATTERN.test(v.fee_per_extra_kg), { path: ['fee_per_extra_kg'], message: 'Per extra kg: a non-negative amount with at most 2 decimals.' })
  .refine((v) => !v.cod_allowed || MONEY_PATTERN.test(v.cod_fee), { path: ['cod_fee'], message: 'COD fee: a non-negative amount with at most 2 decimals.' })

export type MethodValues = z.infer<typeof methodSchema>
export const METHOD_FIELDS = ['name', 'description', 'fee', 'free_over', 'cod_allowed', 'cod_fee', 'eta_min_days', 'eta_max_days', 'is_active', 'sort_order', 'weight_included_kg', 'fee_per_extra_kg', 'translations'] as const

/** A weight in kg: up to 7 whole digits and 3 decimals. */
const KG_PATTERN = /^\d{1,7}(\.\d{1,3})?$/

export function toMethodValues(method: ShippingMethod | null, nextSortOrder = 0): MethodValues {
  return {
    name: method?.name ?? '',
    description: method?.description ?? '',
    fee: method?.fee ?? '0.00',
    free_over: method?.free_over ?? '',
    cod_allowed: method?.cod_allowed ?? true,
    cod_fee: method?.cod_fee ?? '0.00',
    eta_min_days: method?.eta_min_days ?? 1,
    eta_max_days: method?.eta_max_days ?? 3,
    is_active: method?.is_active ?? true,
    sort_order: method?.sort_order ?? nextSortOrder,
    weight_pricing: method?.weight_included_kg != null,
    weight_included_kg: method?.weight_included_kg != null ? trimDecimal(method.weight_included_kg) : '1',
    fee_per_extra_kg: method?.fee_per_extra_kg ?? '0.00',
    translations: { bn: readBn(method?.translations, METHOD_TRANSLATION_NAMES) },
  }
}

/** `before`: the method's translations as loaded (null for a new method). */
export function toMethodInput(v: MethodValues, before?: TranslationsMap): MethodInput {
  return {
    name: v.name,
    description: v.description || null,
    fee: v.fee,
    free_over: v.free_over || null,
    cod_allowed: v.cod_allowed,
    cod_fee: v.cod_allowed ? v.cod_fee : '0.00',
    eta_min_days: v.eta_min_days,
    eta_max_days: v.eta_max_days,
    is_active: v.is_active,
    sort_order: v.sort_order,
    weight_included_kg: v.weight_pricing ? v.weight_included_kg : null,
    fee_per_extra_kg: v.weight_pricing ? v.fee_per_extra_kg : '0.00',
    translations: toTranslationsInput(v.translations.bn, METHOD_TRANSLATION_NAMES, before),
  }
}

/** "BDT 60.00 + BDT 20.00 per kg over 1 kg" — the weight part of a method's fee, or null without weight pricing. */
export function weightSummary(method: Pick<ShippingMethod, 'weight_included_kg' | 'fee_per_extra_kg'>, currency?: string): string | null {
  if (method.weight_included_kg == null) return null
  return `+ ${formatMoney(method.fee_per_extra_kg ?? '0', currency)} per kg over ${trimDecimal(method.weight_included_kg)} kg`
}

// ── Delivery areas (BD2a) ────────────────────────────────────────────────────

export const AREA_NAME_MAX = 80

/** A fee change: an amount with at most 2 decimals, may be negative (a cheaper area). */
const SIGNED_MONEY = /^-?\d{1,16}(\.\d{1,2})?$/

export const areaSchema = z.object({
  name: z.string().trim().min(1, 'Required.').max(AREA_NAME_MAX, `At most ${AREA_NAME_MAX} characters.`),
  fee_adjustment: z.string().trim().regex(SIGNED_MONEY, 'An amount like 20 or -10 (at most 2 decimals).'),
  is_active: z.boolean(),
  sort_order: z.number({ error: 'A whole number.' }).int('A whole number.').min(0, 'A whole number.'),
})

export type AreaValues = z.infer<typeof areaSchema>
export const AREA_FIELDS = ['name', 'fee_adjustment', 'is_active', 'sort_order'] as const

export function toAreaValues(area: ShippingArea | null, nextSortOrder = 0): AreaValues {
  return { name: area?.name ?? '', fee_adjustment: area?.fee_adjustment ?? '0.00', is_active: area?.is_active ?? true, sort_order: area?.sort_order ?? nextSortOrder }
}

export function toAreaInput(v: AreaValues, districtId: number): AreaInput {
  return { district_id: districtId, name: v.name, fee_adjustment: v.fee_adjustment, is_active: v.is_active, sort_order: v.sort_order }
}

/** "+ BDT 20.00", "− BDT 10.00" or "No change". */
export function adjustmentLabel(amount: string, currency?: string): string {
  if (/^-?0+(\.0+)?$/.test(amount)) return 'No change'
  return amount.startsWith('-') ? `− ${formatMoney(amount.slice(1), currency)}` : `+ ${formatMoney(amount, currency)}`
}

export function sortAreas(areas: ShippingArea[]): ShippingArea[] {
  return [...areas].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
}

// ── Couriers (E10a) ──────────────────────────────────────────────────────────

export const TRACKING_PLACEHOLDER = '{tracking}'

const trackingTemplate = z
  .string()
  .trim()
  .max(500, 'At most 500 characters.')
  .refine((v) => v === '' || /^https?:\/\/[^\s]+$/i.test(v), 'A web address starting with http:// or https://.')
  .refine((v) => v === '' || v.includes(TRACKING_PLACEHOLDER), `Must contain ${TRACKING_PLACEHOLDER} where the tracking number goes.`)

export const courierSchema = z.object({
  name: z.string().trim().min(1, 'Required.').max(80, 'At most 80 characters.'),
  phone: z.string().trim().max(20, 'At most 20 characters.'),
  tracking_url_template: trackingTemplate,
  is_active: z.boolean(),
  sort_order: z.number({ error: 'A whole number.' }).int('A whole number.').min(0, 'A whole number.'),
})

export type CourierValues = z.infer<typeof courierSchema>
export const COURIER_FIELDS = ['name', 'phone', 'tracking_url_template', 'is_active', 'sort_order'] as const

export function toCourierValues(courier: Courier | null, nextSortOrder = 0): CourierValues {
  return {
    name: courier?.name ?? '',
    phone: courier?.phone ?? '',
    tracking_url_template: courier?.tracking_url_template ?? '',
    is_active: courier?.is_active ?? true,
    sort_order: courier?.sort_order ?? nextSortOrder,
  }
}

export function toCourierInput(v: CourierValues): CourierInput {
  return {
    name: v.name,
    phone: v.phone || null,
    tracking_url_template: v.tracking_url_template || null,
    is_active: v.is_active,
    sort_order: v.sort_order,
  }
}

/** The tracking page for a parcel, as the server builds it: the template with the url-encoded number. */
export function trackingUrl(template: string | null | undefined, trackingNumber: string | null | undefined): string | null {
  if (!template || !trackingNumber || !template.includes(TRACKING_PLACEHOLDER)) return null
  return template.replaceAll(TRACKING_PLACEHOLDER, encodeURIComponent(trackingNumber))
}

export function sortCouriers(couriers: Courier[]): Courier[] {
  return [...couriers].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
}

/** Explains a refused delete: a courier with shipments stays for the record and can only be deactivated. */
export function courierDeleteError(error: unknown, name: string): string {
  if (error instanceof ApiError && error.code === 'IN_USE') return `${name} has shipments, so it cannot be deleted. Switch it off instead to hide it from the ship dialog.`
  return error instanceof Error ? error.message : 'Something went wrong.'
}
