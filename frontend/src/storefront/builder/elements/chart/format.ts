/*
 * Number and text helpers of the chart: values with the owner's unit, clean axis ticks (in full
 * under 10,000, compact on an axis that reaches it — marks-and-anatomy.md), and a deterministic
 * text-width estimate (no DOM measuring, so layout is the same in tests and in the browser and
 * labels can be fitted before they are drawn).
 */

export type NumberFormatter = (value: number | string, options?: Intl.NumberFormatOptions) => string

const plain: NumberFormatter = (value, options) => new Intl.NumberFormat('en', options).format(Number(value))

/** A value as the reader sees it: `৳1,200`, `45%`, `12 pcs`. */
export function formatValue(value: number, unit: string, position: 'before' | 'after', fmt: NumberFormatter = plain): string {
  const number = fmt(value, { maximumFractionDigits: 2 })
  if (!unit) return number
  if (position === 'before') return value < 0 ? `-${unit}${number.replace(/^-|^−/, '')}` : `${unit}${number}`
  // Symbols hug the number ("45%"); words get a space ("12 pcs").
  return /^[\p{L}]/u.test(unit) && unit.length > 1 ? `${number} ${unit}` : `${number}${unit}`
}

/** Axis tick text: compact (10K, 2.5M) when the axis reaches 10,000, in full below. */
export function tickFormatter(maxAbs: number, unit: string, position: 'before' | 'after', fmt: NumberFormatter = plain): (value: number) => string {
  // Long word units ("pcs", "kg") stay off the ticks — the axis caption carries them.
  const tickUnit = unit.length <= 2 ? unit : ''
  if (maxAbs < 10_000) return (v) => formatValue(v, tickUnit, position, fmt)
  const [div, suffix] = maxAbs >= 1e9 ? [1e9, 'B'] : maxAbs >= 1e6 ? [1e6, 'M'] : [1e3, 'K']
  return (v) => {
    const n = fmt(v / div, { maximumFractionDigits: 1 }) + (v === 0 ? '' : suffix)
    if (!tickUnit) return n
    return position === 'before' ? (v < 0 ? `-${tickUnit}${n.replace(/^-|^−/, '')}` : `${tickUnit}${n}`) : `${n}${tickUnit}`
  }
}

/** The unit as an axis caption when it is too long for the ticks, else ''. */
export function axisUnitCaption(unit: string): string {
  return unit.length > 2 ? unit : ''
}

/** A share as a percentage: 0.4567 → "46%". */
export function formatShare(share: number, fmt: NumberFormatter = plain): string {
  return `${fmt(Math.round(share * 100))}%`
}

/*
 * Width estimate in px for `fontPx` text in the storefront's body font (Poppins, a wide sans, is the
 * widest of the theme fonts — estimates err wide so fitted labels never collide).
 */
export function textWidth(textValue: string, fontPx: number): number {
  let em = 0
  for (const ch of textValue) {
    if (ch === ' ') em += 0.3
    else if (/[0-9]/.test(ch)) em += 0.62
    else if (/[.,:;'!|il]/.test(ch)) em += 0.3
    else if (/[A-Z]/.test(ch)) em += 0.72
    else if (/[mwMW]/.test(ch)) em += 0.9
    else if (/[ঀ-৿]/.test(ch)) em += 0.62 // Bengali (combining signs make per-char estimates wide enough)
    else em += 0.58
  }
  return em * fontPx
}

/** `text` cut with an ellipsis to fit `maxPx`, or '' when not even one character and the ellipsis fit. */
export function truncateToWidth(textValue: string, maxPx: number, fontPx: number): string {
  if (textWidth(textValue, fontPx) <= maxPx) return textValue
  const chars = Array.from(textValue)
  for (let n = chars.length - 1; n >= 1; n--) {
    const candidate = chars.slice(0, n).join('').trimEnd() + '…'
    if (textWidth(candidate, fontPx) <= maxPx) return candidate
  }
  return ''
}
