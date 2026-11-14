/** P2b: the shop's WhatsApp number as the storefront settings accept it. */

/** Spaces, dashes, dots and brackets people type in phone numbers. */
export const cleanPhone = (value: string) => value.replace(/[\s\-().]/g, '')

/**
 * A Bangladeshi mobile (01XXXXXXXXX, 8801…, +8801…) or any international number with "+"
 * (8–15 digits), as the server accepts; empty clears the number.
 */
export function whatsappNumberProblem(value: string): string | null {
  const v = cleanPhone(value)
  if (v === '' || /^(01\d{9}|8801\d{9}|\+8801\d{9}|\+\d{8,15})$/.test(v)) return null
  return 'Enter a mobile number like 01712345678 or +8801712345678.'
}

/** The digits the server stores ("01712345678" → "8801712345678"); "" for none. */
export function whatsappDigits(value: string): string {
  const v = cleanPhone(value).replace(/^\+/, '')
  return /^01\d{9}$/.test(v) ? `88${v}` : v
}
