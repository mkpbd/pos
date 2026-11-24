/**
 * A linear barcode as modules: '1' is a dark module (bar), '0' a light one (space).
 * Coordinates are in modules from the first module of the symbol (quiet zones excluded).
 */
export type LinearSymbol = {
  modules: string
  /** Light margin a scanner needs on each side, in modules. */
  quietLeft: number
  quietRight: number
  /** Module ranges [start, end) whose bars run longer (EAN / UPC guard bars). */
  guards: [number, number][]
  /** Human-readable characters: centre x in modules (may lie in a quiet zone). */
  text: { x: number; value: string }[]
}

/** Runs of equal modules as [start, width, dark]. */
export function moduleRuns(modules: string): { start: number; width: number; dark: boolean }[] {
  const runs: { start: number; width: number; dark: boolean }[] = []
  for (let i = 0; i < modules.length; ) {
    const dark = modules[i] === '1'
    let j = i
    while (j < modules.length && (modules[j] === '1') === dark) j++
    runs.push({ start: i, width: j - i, dark })
    i = j
  }
  return runs
}

/** Bar and space widths in modules, starting with the first bar (e.g. "211232" for Code 128 Start C). */
export function barWidths(modules: string): string {
  return moduleRuns(modules).map((r) => String(r.width)).join('')
}

/** "211232" → "11010011100": widths alternate bar, space, bar… */
export function widthsToModules(widths: string): string {
  let out = ''
  for (let i = 0; i < widths.length; i++) out += (i % 2 === 0 ? '1' : '0').repeat(Number(widths[i]))
  return out
}
