import { encodeCode128 } from '@/features/labels/barcode/code128'
import { encodeEan13, encodeEan8, encodeUpcA, withCheckDigit } from '@/features/labels/barcode/ean'
import { moduleRuns, type LinearSymbol } from '@/features/labels/barcode/symbol'

export type BarcodeFormat = 'ean13' | 'ean8' | 'upca' | 'code128'

export const BARCODE_FORMAT_LABELS: Record<BarcodeFormat, string> = { ean13: 'EAN-13', ean8: 'EAN-8', upca: 'UPC-A', code128: 'Code 128' }

/** The retail format a code fits (right length and check digit), else Code 128. */
export function detectBarcodeFormat(code: string): BarcodeFormat {
  const value = code.trim()
  if (value.length === 13 && withCheckDigit(value, 13)) return 'ean13'
  if (value.length === 12 && withCheckDigit(value, 12)) return 'upca'
  if (value.length === 8 && withCheckDigit(value, 8)) return 'ean8'
  return 'code128'
}

/**
 * The symbol for a code in the given format. A code that does not fit the format (wrong length
 * or check digit) falls back to Code 128 so it still scans as typed; null when even that fails
 * (characters outside printable ASCII).
 */
export function buildSymbol(code: string, format: BarcodeFormat): { symbol: LinearSymbol; format: BarcodeFormat } | null {
  const value = code.trim()
  const encoders: Record<Exclude<BarcodeFormat, 'code128'>, (v: string) => LinearSymbol | null> = { ean13: encodeEan13, ean8: encodeEan8, upca: encodeUpcA }
  if (format !== 'code128' && value.length === { ean13: 13, ean8: 8, upca: 12 }[format]) {
    const symbol = encoders[format](value)
    if (symbol) return { symbol, format }
  }
  const symbol = encodeCode128(value)
  return symbol ? { symbol, format: 'code128' } : null
}

/** Largest module drawn: wider bars only waste label space (nominal EAN module is 0.33 mm). */
export const MAX_MODULE_MM = 0.4

/** Smallest human-readable digit height worth printing. */
export const MIN_DIGITS_MM = 1.5

export type BarcodeGeometry = {
  /** Drawn width in mm (≤ the box), with quiet zones. */
  widthMm: number
  /** viewBox size in modules. */
  viewWidth: number
  viewHeight: number
  /** SVG path of the bars, in modules (quiet zone offset applied). */
  path: string
  fontSize: number
  textY: number
  text: { x: number; value: string }[]
}

/**
 * Lays a symbol out in a box of `widthMm` × `heightMm`: one module is the width over the total
 * modules (capped at MAX_MODULE_MM), bars fill the height above the digits and
 * guard bars reach halfway into the digit band.
 */
export function barcodeGeometry(symbol: LinearSymbol, widthMm: number, heightMm: number, showText: boolean): BarcodeGeometry {
  const total = symbol.quietLeft + symbol.modules.length + symbol.quietRight
  const moduleMm = Math.min(widthMm / total, MAX_MODULE_MM)
  const viewHeight = heightMm / moduleMm
  // Digits smaller than 1.5 mm cannot be read: the bars get the whole height instead.
  const readable = showText && Math.min(9, viewHeight * 0.3) * moduleMm >= MIN_DIGITS_MM
  const fontSize = readable ? Math.min(9, viewHeight * 0.3) : 0
  const band = readable ? fontSize * 1.15 : 0
  const barHeight = viewHeight - band
  const guardHeight = readable && symbol.guards.length > 0 ? barHeight + band * 0.5 : barHeight
  const inGuard = (x: number) => symbol.guards.some(([from, to]) => x >= from && x < to)

  const fmt = (n: number) => String(Math.round(n * 1000) / 1000)
  const path = moduleRuns(symbol.modules)
    .filter((run) => run.dark)
    .map((run) => `M${fmt(run.start + symbol.quietLeft)} 0h${run.width}v${fmt(inGuard(run.start) ? guardHeight : barHeight)}h-${run.width}z`)
    .join('')

  return {
    widthMm: total * moduleMm,
    viewWidth: total,
    viewHeight,
    path,
    fontSize,
    textY: barHeight + fontSize * 0.95,
    text: readable ? symbol.text.map((t) => ({ x: t.x + symbol.quietLeft, value: t.value })) : [],
  }
}
