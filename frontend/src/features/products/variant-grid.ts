import { z } from 'zod'
import { decimalPattern, MONEY_PATTERN, compareDecimal } from '@/lib/money'
import type { Product, VariantGridInput } from '@/features/products/api'

/** Server limits (P1a): at most 3 options and 200 variants per product. */
export const MAX_OPTIONS = 3
export const MAX_VARIANTS = 200
export const MAX_OPTION_VALUES = 50

const money = z.string().trim().regex(MONEY_PATTERN, 'Amount with up to 2 decimals.')
const optionalMoney = z.union([money, z.literal('')])
const QUANTITY = /^\d{1,15}(\.\d{1,3})?$/

const rowSchema = z.object({
  id: z.string().optional(),
  option_values: z.record(z.string(), z.string()),
  sku: z.string().trim().max(64, 'At most 64 characters.').regex(/^[A-Za-z0-9\-_./]*$/, 'Letters, digits and - _ . / only.'),
  /** Barcodes separated by commas, spaces or new lines. */
  barcodes: z.string(),
  purchase_price: money,
  selling_price: money,
  wholesale_price: optionalMoney,
  compare_at_price: optionalMoney,
  reorder_level: z.union([z.string().trim().regex(decimalPattern(3), 'Up to 3 decimals.'), z.literal('')]),
  is_active: z.boolean(),
  /** New rows only: quantity put in stock when saved ("" = none). */
  opening_stock: z.union([z.string().trim().regex(QUANTITY, 'A positive quantity.'), z.literal('')]),
  /** The combination is no longer in the options: kept, inactive, for its history. */
  removed: z.boolean(),
})

export const variantGridSchema = z
  .object({
    options: z
      .array(z.object({ name: z.string().trim().min(1, 'Name the option, e.g. Size.').max(50, 'At most 50 characters.'), values: z.string().trim().min(1, 'List at least one value.') }))
      .max(MAX_OPTIONS, `At most ${MAX_OPTIONS} options.`),
    variants: z.array(rowSchema).min(1, 'Add at least one variant.').max(MAX_VARIANTS + 400),
    /** Store receiving the opening stock of new rows. */
    stock_store_id: z.string(),
  })
  .superRefine((form, ctx) => {
    const names = new Set<string>()
    form.options.forEach((o, i) => {
      const key = o.name.trim().toLowerCase()
      if (key && names.has(key)) ctx.addIssue({ code: 'custom', path: ['options', i, 'name'], message: 'Each option needs its own name.' })
      names.add(key)
      if (splitValues(o.values).length > MAX_OPTION_VALUES) ctx.addIssue({ code: 'custom', path: ['options', i, 'values'], message: `At most ${MAX_OPTION_VALUES} values.` })
    })
    const skus = new Map<string, number>()
    const barcodes = new Map<string, number>()
    form.variants.forEach((v, i) => {
      const sku = v.sku.trim().toLowerCase()
      if (sku) {
        if (skus.has(sku)) ctx.addIssue({ code: 'custom', path: ['variants', i, 'sku'], message: `Same SKU as row ${(skus.get(sku) ?? 0) + 1}.` })
        else skus.set(sku, i)
      }
      for (const code of splitBarcodes(v.barcodes)) {
        if (barcodes.has(code) && barcodes.get(code) !== i) {
          ctx.addIssue({ code: 'custom', path: ['variants', i, 'barcodes'], message: `Barcode ${code} is also on row ${(barcodes.get(code) ?? 0) + 1}.` })
        } else barcodes.set(code, i)
      }
      const compare = v.compare_at_price.trim()
      if (compare && MONEY_PATTERN.test(compare) && MONEY_PATTERN.test(v.selling_price.trim()) && compareDecimal(compare, v.selling_price.trim()) <= 0) {
        ctx.addIssue({ code: 'custom', path: ['variants', i, 'compare_at_price'], message: 'Must be higher than the selling price.' })
      }
    })
    if (form.variants.filter((v) => !v.removed).length > MAX_VARIANTS) {
      ctx.addIssue({ code: 'custom', path: ['variants'], message: `At most ${MAX_VARIANTS} variants per product.` })
    }
    if (!form.stock_store_id && form.variants.some((v) => !v.id && v.opening_stock.trim() !== '' && !/^0+(\.0+)?$/.test(v.opening_stock.trim()))) {
      ctx.addIssue({ code: 'custom', path: ['stock_store_id'], message: 'Choose where the opening stock goes.' })
    }
  })

export type VariantGridValues = z.infer<typeof variantGridSchema>
export type GridRow = VariantGridValues['variants'][number]
export type GridOption = VariantGridValues['options'][number]

export function splitValues(value: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of value.split(/[,\n]+/)) {
    const v = raw.trim()
    if (v && !seen.has(v.toLowerCase())) {
      seen.add(v.toLowerCase())
      out.push(v)
    }
  }
  return out
}

export function splitBarcodes(value: string): string[] {
  return [...new Set(value.split(/[\s,]+/).map((v) => v.trim()).filter(Boolean))]
}

export function emptyRow(optionValues: Record<string, string> = {}): GridRow {
  return {
    option_values: optionValues, sku: '', barcodes: '', purchase_price: '', selling_price: '', wholesale_price: '', compare_at_price: '',
    reorder_level: '', is_active: true, opening_stock: '', removed: false,
  }
}

const trimLevel = (v: string) => v.replace(/\.?0+$/, '') || '0'

export function toGridValues(product: Product): VariantGridValues {
  const options = (product.options ?? []).map((o) => ({ name: o.name, values: o.values.join(', ') }))
  const variants = product.variants.map<GridRow>((v) => ({
    id: v.id,
    option_values: { ...v.option_values },
    sku: v.sku,
    barcodes: v.barcodes.join(', '),
    purchase_price: v.purchase_price ?? '',
    selling_price: v.selling_price,
    wholesale_price: v.wholesale_price ?? '',
    compare_at_price: v.compare_at_price ?? '',
    reorder_level: trimLevel(v.reorder_level),
    is_active: v.is_active,
    opening_stock: '',
    // A saved variant whose combination is not part of the options any more.
    removed: options.length > 0 && !inOptions(v.option_values, options),
  }))
  return { options, variants: variants.length ? variants : [emptyRow()], stock_store_id: '' }
}

function inOptions(values: Record<string, string>, options: GridOption[]): boolean {
  return options.every((o) => {
    const value = values[o.name] ?? Object.entries(values).find(([k]) => k.toLowerCase() === o.name.toLowerCase())?.[1]
    return value !== undefined && splitValues(o.values).some((x) => x.toLowerCase() === value.toLowerCase())
  })
}

/** Variant label from its option values: "Red / M" (or "Default" without options). */
export function rowLabel(row: Pick<GridRow, 'option_values'>, options?: { name: string }[]): string {
  const values = options && options.length ? options.map((o) => valueOf(row.option_values, o.name)).filter(Boolean) : Object.values(row.option_values)
  return values.join(' / ') || 'Default'
}

function valueOf(values: Record<string, string>, name: string): string | undefined {
  return values[name] ?? Object.entries(values).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1]
}

function comboKey(values: Record<string, string>): string {
  return JSON.stringify(Object.keys(values).map((k) => [k.toLowerCase(), (values[k] ?? '').toLowerCase()]).sort())
}

/** "Red" → "RED", "X Large" → "XLARGE"; values without Latin letters or digits fall back to their position. */
export function skuSegment(value: string, position: number): string {
  const clean = value.normalize('NFKD').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 10)
  return clean || String(position + 1)
}

/** A short SKU start from the product name: "Polo Shirt" → "POLOSHIRT" (max 12). */
export function defaultSkuBase(name: string): string {
  return name.normalize('NFKD').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 12) || 'SKU'
}

/** `<base>-<VAL1>-<VAL2>` for a combination, in option order. */
export function skuFor(base: string, values: Record<string, string>, options: { name: string; values: string[] }[]): string {
  const parts = options.map((o) => {
    const value = valueOf(values, o.name) ?? ''
    return skuSegment(value, Math.max(0, o.values.findIndex((v) => v.toLowerCase() === value.toLowerCase())))
  })
  return [base.trim().toUpperCase(), ...parts].filter(Boolean).join('-').slice(0, 64)
}

export class TooManyVariantsError extends Error {
  readonly count: number

  constructor(count: number) {
    super(`These options make ${count} variants; the limit is ${MAX_VARIANTS}. Remove some values.`)
    this.count = count
  }
}

export function combinationCount(options: GridOption[]): number {
  const parsed = options.map((o) => splitValues(o.values).length).filter((n) => n > 0)
  return parsed.length ? parsed.reduce((a, b) => a * b, 1) : 1
}

/**
 * Cartesian product of the option values (P1a §2). Existing rows are matched by their option
 * values (case-insensitive) and keep their id, SKU, prices and barcodes; a saved variant gaining
 * a new option (e.g. "M" → "M / Red") is reused for the first matching combination. Saved
 * variants that no longer fit are kept at the end as removed and inactive (never deleted: they
 * may have sales and stock history). New rows copy the prices of the first row and get an
 * automatic SKU `<base>-<VAL1>-<VAL2>`.
 */
export function generateRows(options: GridOption[], existing: GridRow[], skuBase: string): GridRow[] {
  const parsed = options.map((o) => ({ name: o.name.trim(), values: splitValues(o.values) })).filter((o) => o.name && o.values.length)
  const count = parsed.length ? parsed.reduce((n, o) => n * o.values.length, 1) : 1
  if (count > MAX_VARIANTS) throw new TooManyVariantsError(count)

  let combos: Record<string, string>[] = [{}]
  for (const option of parsed) combos = combos.flatMap((combo) => option.values.map((value) => ({ ...combo, [option.name]: value })))

  const template = existing.find((r) => !r.removed) ?? existing[0]
  const used = new Set<GridRow>()
  const byKey = new Map<string, GridRow>()
  for (const row of existing) if (!byKey.has(comboKey(row.option_values))) byKey.set(comboKey(row.option_values), row)

  const matched: (GridRow | undefined)[] = combos.map((combo) => {
    const match = byKey.get(comboKey(combo))
    if (match && !used.has(match)) {
      used.add(match)
      return match
    }
    return undefined
  })
  // Saved variants whose values are a subset of a new combination (an option was added).
  for (const row of existing) {
    if (used.has(row) || !row.id) continue
    const entries = Object.entries(row.option_values)
    const index = combos.findIndex((combo, i) => !matched[i] && entries.every(([k, v]) => (valueOf(combo, k) ?? '').toLowerCase() === v.toLowerCase()))
    if (index >= 0) {
      matched[index] = row
      used.add(row)
    }
  }

  const rows = combos.map<GridRow>((combo, i) => {
    const match = matched[i]
    if (match) return { ...match, option_values: combo, removed: false, is_active: match.removed ? true : match.is_active }
    return {
      ...emptyRow(combo),
      sku: parsed.length ? skuFor(skuBase, combo, parsed) : '',
      purchase_price: template?.purchase_price ?? '',
      selling_price: template?.selling_price ?? '',
      wholesale_price: template?.wholesale_price ?? '',
      compare_at_price: template?.compare_at_price ?? '',
      reorder_level: template?.reorder_level ?? '',
    }
  })
  const removed = existing.filter((r) => r.id && !used.has(r)).map((r) => ({ ...r, removed: true, is_active: false, opening_stock: '' }))
  return [...rows, ...removed]
}

/** Rows whose option `name` has `value`. */
export function rowsWithValue(rows: GridRow[], name: string, value: string): number[] {
  return rows.flatMap((r, i) => ((valueOf(r.option_values, name) ?? '').toLowerCase() === value.toLowerCase() ? [i] : []))
}

export type BulkField = 'selling_price' | 'purchase_price' | 'wholesale_price' | 'compare_at_price'

export type BulkAction =
  | { kind: 'set'; field: BulkField | 'reorder_level'; value: string }
  | { kind: 'percent'; field: Exclude<BulkField, 'compare_at_price'>; percent: string }
  | { kind: 'active'; value: boolean }

export const PERCENT_PATTERN = /^-?\d{1,3}(\.\d{1,2})?$/

/**
 * price × (100 + percent) / 100, rounded half up to 2 decimals — exact decimal arithmetic,
 * never floats. "450" + "10" → "495.00"; "99.99" − "15" → "84.99".
 */
export function addPercent(price: string, percent: string): string {
  const scaled = (value: string, scale: number) => {
    const negative = value.trim().startsWith('-')
    const [i = '0', f = ''] = value.trim().replace(/^-/, '').split('.')
    const n = BigInt((i || '0') + (f + '0'.repeat(scale)).slice(0, scale))
    return negative ? -n : n
  }
  const cents = scaled(price, 2) // ×100
  const factor = 10000n + scaled(percent, 2) // (100 + p) × 100
  const numerator = cents * factor // price × (100 + p) × 10⁴
  let result = numerator / 10000n
  const rest = numerator % 10000n
  if (rest * 2n >= 10000n) result += 1n
  if (result < 0n) result = 0n
  const digits = result.toString().padStart(3, '0')
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`
}

/** Applies a bulk edit to the rows at `indexes`; returns new rows (others untouched). */
export function applyBulk(rows: GridRow[], indexes: number[], action: BulkAction): GridRow[] {
  const targets = new Set(indexes)
  return rows.map((row, i) => {
    if (!targets.has(i)) return row
    switch (action.kind) {
      case 'set':
        return { ...row, [action.field]: action.value.trim() }
      case 'percent': {
        const current = row[action.field].trim()
        return MONEY_PATTERN.test(current) ? { ...row, [action.field]: addPercent(current, action.percent.trim()) } : row
      }
      case 'active':
        return row.removed && action.value ? row : { ...row, is_active: action.value }
    }
  })
}

/** Validates a bulk value; returns an error message or null. */
export function bulkValueError(action: { kind: BulkAction['kind']; field?: string }, value: string): string | null {
  const v = value.trim()
  if (action.kind === 'active') return null
  if (action.kind === 'percent') return PERCENT_PATTERN.test(v) ? null : 'A percentage like 10 or -15.'
  if (action.field === 'reorder_level') return decimalPattern(3).test(v) ? null : 'A number (up to 3 decimals).'
  if (action.field === 'wholesale_price' || action.field === 'compare_at_price') return v === '' || MONEY_PATTERN.test(v) ? null : 'Amount with up to 2 decimals, or empty.'
  return MONEY_PATTERN.test(v) ? null : 'Amount with up to 2 decimals.'
}

const isPositive = (v: string) => v.trim() !== '' && !/^0+(\.0+)?$/.test(v.trim())

/**
 * The PUT /products/{id}/variants body. Rows marked removed (their combination left the options)
 * are left out: the server deactivates them when they have history and archives them otherwise.
 * `rowOf[i]` is the form row of payload variant i, for putting server errors on the right row.
 */
export function toGridInput(form: VariantGridValues): { input: VariantGridInput; rowOf: number[] } {
  const options = form.options.map((o) => ({ name: o.name.trim(), values: splitValues(o.values) })).filter((o) => o.name && o.values.length)
  const rowOf: number[] = []
  const variants: VariantGridInput['variants'] = []
  form.variants.forEach((v, i) => {
    if (v.removed) return
    rowOf.push(i)
    variants.push({
      ...(v.id ? { id: v.id } : {}),
      option_values: options.length ? v.option_values : {},
      sku: v.sku.trim() || null,
      barcodes: splitBarcodes(v.barcodes),
      purchase_price: v.purchase_price.trim(),
      selling_price: v.selling_price.trim(),
      wholesale_price: v.wholesale_price.trim() || null,
      compare_at_price: v.compare_at_price.trim() || null,
      reorder_level: v.reorder_level.trim() || '0',
      is_active: v.is_active,
      ...(!v.id && isPositive(v.opening_stock) ? { opening_stock: v.opening_stock.trim() } : {}),
    })
  })
  const withOpening = variants.some((v) => v.opening_stock !== undefined)
  return { input: { options: options.length ? options : null, variants, ...(withOpening ? { stock_store_id: form.stock_store_id } : {}) }, rowOf }
}

/** Server error key "variants.3.sku" → form key using `rowOf`; other keys unchanged. */
export function gridErrorKey(key: string, rowOf: number[]): string {
  const match = /^variants\.(\d+)(\..+)?$/.exec(key)
  if (!match) return key
  const row = rowOf[Number(match[1])]
  return row === undefined ? 'variants' : `variants.${row}${match[2] ?? ''}`
}

/** Spreadsheet-style paste: rows by new line, cells by tab. */
export function parseClipboard(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n')
  return lines.map((line) => line.split('\t').map((c) => c.trim()))
}
