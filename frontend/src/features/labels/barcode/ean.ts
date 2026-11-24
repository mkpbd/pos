import type { LinearSymbol } from '@/features/labels/barcode/symbol'

/**
 * EAN-13, EAN-8 and UPC-A (GS1 General Specifications, section 5.2).
 *
 * Every digit takes 7 modules. Left-hand digits use set A ("L", odd parity) or set B ("G",
 * even parity); right-hand digits use set C ("R"). In EAN-13 the first digit is not drawn as
 * bars: it picks the A/B pattern of the left half.
 */
export const EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'] as const
/** Set C: the complement of set A. */
export const EAN_R = EAN_L.map((p) => [...p].map((m) => (m === '1' ? '0' : '1')).join(''))
/** Set B: set C read backwards. */
export const EAN_G = EAN_R.map((p) => [...p].reverse().join(''))
/** Left-half parity per leading digit of an EAN-13. */
export const EAN13_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'] as const

const START = '101'
const CENTRE = '01010'
const END = '101'

const isDigits = (value: string) => /^\d+$/.test(value)

/** Modulo-10 check digit: weights 3, 1, 3… from the rightmost data digit. */
export function gs1CheckDigit(data: string): number {
  let sum = 0
  for (let i = data.length - 1, weight = 3; i >= 0; i--, weight = 4 - weight) sum += Number(data[i]) * weight
  return (10 - (sum % 10)) % 10
}

/**
 * The full code with its check digit: `length - 1` digits get one appended, `length` digits must
 * carry the right one. Anything else is null.
 */
export function withCheckDigit(value: string, length: number): string | null {
  const code = value.trim()
  if (!isDigits(code)) return null
  if (code.length === length - 1) return code + String(gs1CheckDigit(code))
  if (code.length === length && Number(code[length - 1]) === gs1CheckDigit(code.slice(0, -1))) return code
  return null
}

function digit(set: 'L' | 'G' | 'R', d: string): string {
  const n = Number(d)
  return set === 'L' ? EAN_L[n]! : set === 'G' ? EAN_G[n]! : EAN_R[n]!
}

/** Centre of the n-th 7-module digit starting at module `from`. */
const centre = (from: number, n: number) => from + n * 7 + 3.5

/** EAN-13 from 12 digits (check digit added) or 13 (check digit verified). */
export function encodeEan13(value: string): LinearSymbol | null {
  const code = withCheckDigit(value, 13)
  if (!code) return null
  const parity = EAN13_PARITY[Number(code[0])]!
  const left = [...code.slice(1, 7)].map((d, i) => digit(parity[i] as 'L' | 'G', d)).join('')
  const right = [...code.slice(7)].map((d) => digit('R', d)).join('')
  return {
    modules: START + left + CENTRE + right + END,
    quietLeft: 11,
    quietRight: 7,
    guards: [[0, 3], [45, 50], [92, 95]],
    text: [
      { x: -6, value: code[0]! },
      ...[...code.slice(1, 7)].map((value, i) => ({ x: centre(3, i), value })),
      ...[...code.slice(7)].map((value, i) => ({ x: centre(50, i), value })),
    ],
  }
}

/** EAN-8 from 7 digits (check digit added) or 8 (check digit verified). */
export function encodeEan8(value: string): LinearSymbol | null {
  const code = withCheckDigit(value, 8)
  if (!code) return null
  const left = [...code.slice(0, 4)].map((d) => digit('L', d)).join('')
  const right = [...code.slice(4)].map((d) => digit('R', d)).join('')
  return {
    modules: START + left + CENTRE + right + END,
    quietLeft: 7,
    quietRight: 7,
    guards: [[0, 3], [31, 36], [64, 67]],
    text: [
      ...[...code.slice(0, 4)].map((value, i) => ({ x: centre(3, i), value })),
      ...[...code.slice(4)].map((value, i) => ({ x: centre(36, i), value })),
    ],
  }
}

/**
 * UPC-A from 11 digits (check digit added) or 12 (check digit verified). The first and last
 * digits' bars run as long as the guards and their numbers stand outside the bars.
 */
export function encodeUpcA(value: string): LinearSymbol | null {
  const code = withCheckDigit(value, 12)
  if (!code) return null
  const left = [...code.slice(0, 6)].map((d) => digit('L', d)).join('')
  const right = [...code.slice(6)].map((d) => digit('R', d)).join('')
  return {
    modules: START + left + CENTRE + right + END,
    quietLeft: 9,
    quietRight: 9,
    guards: [[0, 10], [45, 50], [85, 95]],
    text: [
      { x: -5, value: code[0]! },
      ...[...code.slice(1, 6)].map((value, i) => ({ x: centre(3, i + 1), value })),
      ...[...code.slice(6, 11)].map((value, i) => ({ x: centre(50, i), value })),
      { x: 100, value: code[11]! },
    ],
  }
}
