import { widthsToModules, type LinearSymbol } from '@/features/labels/barcode/symbol'

/**
 * Code 128 (ISO/IEC 15417) with code sets B (printable ASCII) and C (digit pairs).
 *
 * Each symbol character is 3 bars and 3 spaces, 11 modules wide; the stop character has a
 * final 2-module bar (13 modules). Values 0–102 are data, 103–105 the start characters A/B/C.
 */
export const CODE128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
] as const

export const CODE128 = { START_B: 104, START_C: 105, CODE_B: 100, CODE_C: 99, STOP: 106 } as const

const isPrintable = (code: number) => code >= 32 && code <= 126

/** Number of consecutive digits from `from`. */
function digitRun(text: string, from: number): number {
  let n = 0
  while (from + n < text.length && text.charCodeAt(from + n) >= 48 && text.charCodeAt(from + n) <= 57) n++
  return n
}

/**
 * Symbol values for `text`: start, data, check character and stop. Code set C is used for
 * runs of digits long enough to save space (4+ at the start or end, 6+ in the middle); an odd
 * run keeps its first digit in set B. Null when the text has characters outside printable ASCII.
 */
export function code128Values(text: string): number[] | null {
  if (text.length === 0) return null
  for (let i = 0; i < text.length; i++) if (!isPrintable(text.charCodeAt(i))) return null

  const data: number[] = []
  const leading = digitRun(text, 0)
  let start: number
  let set: 'B' | 'C'
  let i = 0
  if (leading % 2 === 0 && (leading >= 4 || (leading === 2 && text.length === 2))) {
    start = CODE128.START_C
    set = 'C'
  } else if (leading >= 4) {
    // Odd run: the first digit in B, then pairs in C.
    start = CODE128.START_B
    data.push(text.charCodeAt(0) - 32, CODE128.CODE_C)
    set = 'C'
    i = 1
  } else {
    start = CODE128.START_B
    set = 'B'
  }

  while (i < text.length) {
    const run = digitRun(text, i)
    if (set === 'C') {
      if (run >= 2) {
        data.push(Number(text.slice(i, i + 2)))
        i += 2
        continue
      }
      data.push(CODE128.CODE_B)
      set = 'B'
      continue
    }
    const atEnd = i + run === text.length
    if (run >= 6 || (atEnd && run >= 4)) {
      // An odd run sends its first digit in B so the rest pairs up.
      if (run % 2 === 1) {
        data.push(text.charCodeAt(i) - 32)
        i += 1
      }
      data.push(CODE128.CODE_C)
      set = 'C'
      continue
    }
    data.push(text.charCodeAt(i) - 32)
    i += 1
  }

  const values = [start, ...data]
  const check = values.reduce((sum, value, position) => sum + value * Math.max(position, 1), 0) % 103
  return [...values, check, CODE128.STOP]
}

/** Code 128 for any printable ASCII text (SKUs, non-EAN barcodes). */
export function encodeCode128(text: string): LinearSymbol | null {
  const values = code128Values(text)
  if (!values) return null
  const modules = values.map((v) => widthsToModules(CODE128_PATTERNS[v]!)).join('')
  return { modules, quietLeft: 10, quietRight: 10, guards: [], text: [{ x: modules.length / 2, value: text }] }
}
