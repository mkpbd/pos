/**
 * Display helpers for decimal strings from the API ("1234.50").
 *
 * Amounts are formatted by string manipulation, never via binary floats, so what the
 * user sees is exactly what the server stored. No arithmetic happens here: totals are
 * always computed on the server.
 */

/** Accepts "12", "12.5", "12.50" (non-negative, at most `decimals` places). */
export function decimalPattern(decimals: number): RegExp {
  return new RegExp(`^\\d{1,16}(\\.\\d{1,${decimals}})?$`)
}

export const MONEY_PATTERN = decimalPattern(2)

/** Groups an integer string with thousands separators: "1234567" → "1,234,567". */
function groupThousands(integer: string): string {
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/**
 * "1234.5" → "1,234.50" (or "BDT 1,234.50" with a currency). Invalid input is returned unchanged.
 */
export function formatMoney(amount: string | null | undefined, currency?: string, decimals = 2): string {
  if (amount === null || amount === undefined || amount === '') return '—'

  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(amount.trim())
  if (!match) return amount

  const [, sign = '', integer = '0', fraction = ''] = match
  const padded = (fraction + '0'.repeat(decimals)).slice(0, decimals)
  const body = `${sign}${groupThousands(integer.replace(/^0+(?=\d)/, ''))}${decimals > 0 ? `.${padded}` : ''}`

  return currency ? `${currency} ${body}` : body
}

/** Drops insignificant trailing zeros: "12.000000" → "12", "1.500" → "1.5". */
export function trimDecimal(value: string | null | undefined): string {
  if (!value) return ''
  return value.includes('.') ? value.replace(/\.?0+$/, '') : value
}

/**
 * Min–max range of decimal strings for display ("25.00" or "450.00 – 480.00").
 * Compares by normalised string, not float.
 */
export function formatRange(amounts: string[], currency?: string): string {
  if (amounts.length === 0) return '—'
  const sorted = [...amounts].sort(compareDecimal)
  const min = sorted[0] as string
  const max = sorted[sorted.length - 1] as string

  return compareDecimal(min, max) === 0 ? formatMoney(min, currency) : `${formatMoney(min, currency)} – ${formatMoney(max)}`
}

/** Exact comparison of non-negative decimal strings. */
export function compareDecimal(a: string, b: string): number {
  const [ai = '0', af = ''] = a.split('.')
  const [bi = '0', bf = ''] = b.split('.')
  const intA = ai.replace(/^0+(?=\d)/, '')
  const intB = bi.replace(/^0+(?=\d)/, '')
  if (intA.length !== intB.length) return intA.length - intB.length
  if (intA !== intB) return intA < intB ? -1 : 1

  const width = Math.max(af.length, bf.length)
  const fa = af.padEnd(width, '0')
  const fb = bf.padEnd(width, '0')

  return fa === fb ? 0 : fa < fb ? -1 : 1
}
