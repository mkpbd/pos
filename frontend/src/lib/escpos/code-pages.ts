/**
 * Single-byte character sets the printer's text mode understands (ESC t n). Anything a code page
 * cannot hold — Bangla, other scripts, emoji — is printed as a picture instead (raster mode).
 */
export type CodePage = 'cp437' | 'cp1252'

/** `n` of ESC t n: PC437 (USA, standard Europe) is 0; WPC1252 is 16 on Epson-compatible printers. */
export const CODE_PAGE_NUMBER: Record<CodePage, number> = { cp437: 0, cp1252: 16 }

export const CODE_PAGE_LABELS: Record<CodePage, string> = {
  cp1252: 'Windows-1252 (Latin)',
  cp437: 'PC437 (USA)',
}

/** Bytes 0x80–0xFF of each code page, in order. */
const HIGH: Record<CodePage, string> = {
  cp437:
    'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ',
  cp1252:
    '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ' +
    Array.from({ length: 96 }, (_, i) => String.fromCharCode(0xa0 + i)).join(''),
}

const TABLES = new Map<CodePage, Map<string, number>>()

function table(page: CodePage): Map<string, number> {
  let map = TABLES.get(page)
  if (!map) {
    map = new Map(Array.from(HIGH[page]).map((ch, i) => [ch, 0x80 + i]))
    TABLES.set(page, map)
  }
  return map
}

/** The 128 characters of a code page's upper half (exported for tests). */
export function upperHalf(page: CodePage): string[] {
  return Array.from(HIGH[page])
}

/**
 * Plain stand-ins for punctuation the code page may lack, so a Latin receipt stays in text mode
 * (e.g. the narrow no-break space browsers put in times, an em dash in "Shirt — XL", ×, ••••).
 */
const STAND_INS: Record<string, string> = {
  ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ',
  '​': '', '‌': '', '‍': '', '﻿': '',
  '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-', '−': '-',
  '‘': "'", '’': "'", '‚': ',', '“': '"', '”': '"', '„': '"',
  '•': '*', '·': '.', '∙': '.', '×': 'x', '…': '...', '€': 'EUR', '৳': 'Tk', '™': 'TM',
}

/** Whether one character can be printed in text mode with this code page (directly or by a stand-in). */
function printable(ch: string, page: CodePage): boolean {
  const code = ch.codePointAt(0) ?? 0
  if (code >= 0x20 && code < 0x7f) return true
  if (table(page).has(ch)) return true
  const stand = STAND_INS[ch]
  return stand !== undefined && Array.from(stand).every((c) => printable(c, page))
}

/** True when some character of `text` can only be printed as a picture (raster mode). */
export function needsRaster(text: string, page: CodePage): boolean {
  for (const ch of text) {
    if (ch === '\n' || ch === '\r' || ch === '\t') continue
    if (!printable(ch, page)) return true
  }
  return false
}

/**
 * Text → bytes in the code page. Characters it lacks take their stand-in, or "?" when there is none
 * (raster mode is chosen before that happens). Control characters are dropped; tabs become spaces.
 */
export function encodeText(text: string, page: CodePage): number[] {
  const map = table(page)
  const out: number[] = []
  const push = (ch: string): void => {
    const code = ch.codePointAt(0) ?? 0
    if (code >= 0x20 && code < 0x7f) out.push(code)
    else if (ch === '\t') out.push(0x20)
    else if (map.has(ch)) out.push(map.get(ch) as number)
    else if (STAND_INS[ch] !== undefined) for (const c of STAND_INS[ch] as string) push(c)
    else if (code >= 0x20) out.push(0x3f)
  }
  for (const ch of text) push(ch)
  return out
}

/** Text as the printer will show it (stand-ins applied): used for widths and wrapping in text mode. */
export function normalizeText(text: string, page: CodePage): string {
  let out = ''
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    if (code >= 0x20 && code < 0x7f) out += ch
    else if (ch === '\t') out += ' '
    else if (table(page).has(ch)) out += ch
    else if (STAND_INS[ch] !== undefined) out += normalizeText(STAND_INS[ch] as string, page)
    else if (code >= 0x20) out += '?'
  }
  return out
}
