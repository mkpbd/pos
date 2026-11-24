/**
 * BD1a: SMS length and part counting, a port of the server's `Sms\Domain\SmsText::analyze()`.
 *
 * GSM-7: the basic table counts one character each, the extension table (^ { } \ [ ~ ] | € and
 * form feed) two (escape + character); 160 characters fit one SMS, longer texts are sent in parts
 * of 153. Anything outside GSM-7 (Bangla, emoji, curly quotes…) makes the whole message Unicode
 * (UCS-2): 70 characters in one SMS, parts of 67, counted in UTF-16 code units like the phone does.
 */

export type SmsEncoding = 'gsm' | 'unicode'

export type SmsAnalysis = { encoding: SmsEncoding; length: number; segments: number }

const GSM_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'
const GSM_EXTENSION = '^{}\\[~]|€\f'

const BASIC = new Set(Array.from(GSM_BASIC))
const EXTENSION = new Set(Array.from(GSM_EXTENSION))

export const GSM_SINGLE = 160
export const GSM_PART = 153
export const UNICODE_SINGLE = 70
export const UNICODE_PART = 67

function gsmLength(text: string): number | null {
  let length = 0
  for (const ch of text) {
    if (BASIC.has(ch)) length += 1
    else if (EXTENSION.has(ch)) length += 2
    else return null
  }
  return length
}

const parts = (length: number, single: number, part: number) => (length === 0 ? 0 : length <= single ? 1 : Math.ceil(length / part))

export function analyzeSms(text: string): SmsAnalysis {
  const gsm = gsmLength(text)
  if (gsm !== null) return { encoding: 'gsm', length: gsm, segments: parts(gsm, GSM_SINGLE, GSM_PART) }
  return { encoding: 'unicode', length: text.length, segments: parts(text.length, UNICODE_SINGLE, UNICODE_PART) }
}

const numberFormat = new Intl.NumberFormat('en-US')

/** "45 characters · 1 SMS · GSM" */
export function describeSms(analysis: SmsAnalysis): string {
  const chars = `${numberFormat.format(analysis.length)} ${analysis.length === 1 ? 'character' : 'characters'}`
  return `${chars} · ${analysis.segments} SMS · ${analysis.encoding === 'gsm' ? 'GSM' : 'Unicode'}`
}

/**
 * Fills `{placeholder}`s the way the server's `SmsTemplate::render()` does: known names are
 * replaced (missing values → empty), unknown ones are left as typed, double spaces collapse.
 */
export function renderSmsTemplate(template: string, vars: Record<string, string>, known: readonly string[]): string {
  const filled = template.replace(/\{([a-z_]+)\}/g, (match, name: string) => (known.includes(name) ? (vars[name] ?? '') : match))
  return filled.replace(/ {2,}/g, ' ').trim()
}

/** Example values for the template preview and counter (a typical order, a short tracking link). */
export const EXAMPLE_VALUES: Record<string, string> = {
  name: 'Rahim',
  order: 'W-10025',
  total: '1,250.00',
  link: 'https://shop.example.com/track-order?number=W-10025',
  courier: 'Pathao',
  tracking: 'PX1234567',
  tracking_link: 'https://pathao.com/t/PX1234567',
}

/** Inserts `insert` at the selection of a text of `value`; returns the new text and caret position. */
export function insertAt(value: string, insert: string, start: number | null, end: number | null): { value: string; caret: number } {
  const from = start === null ? value.length : Math.max(0, Math.min(start, value.length))
  const to = end === null ? from : Math.max(from, Math.min(end, value.length))
  return { value: value.slice(0, from) + insert + value.slice(to), caret: from + insert.length }
}
