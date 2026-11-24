import { BD_MOBILE, bdPhoneFrom } from '../account/schemas'
import type { CheckoutPreview, CheckoutPreviewInput } from '../types'

/*
 * BD1b: a store may block mobile numbers from cash on delivery. The previews (cart checkout and
 * order forms) take the number once it is a valid mobile and answer `cod_available`; when false,
 * the Cash on delivery option is disabled and placing with it is refused (COD_NOT_AVAILABLE).
 */

/** The typed number as the server keeps it, or null while it is not a valid mobile (no preview per keystroke). */
export function previewPhone(typed: string | null | undefined): string | null {
  if (!typed) return null
  const phone = bdPhoneFrom(typed)
  return BD_MOBILE.test(phone) ? phone : null
}

/** Adds the contact number to a preview body (cart checkout or order form). */
export function withContactPhone<T extends { contact?: { phone: string } }>(input: T, typed: string | null | undefined): T {
  const phone = previewPhone(typed)
  return phone ? { ...input, contact: { phone } } : input
}

/** Cart checkout: the contact number, and the delivery number of a new address once the address is in the body. */
export function withCheckoutPhones(input: CheckoutPreviewInput, contact: string | null | undefined, addressPhone: string | null | undefined): CheckoutPreviewInput {
  const next = withContactPhone(input, contact)
  const phone = previewPhone(addressPhone)
  return next.address && phone ? { ...next, address: { ...next.address, phone } } : next
}

/** Whether the preview says cash on delivery may not be used for the number (absent = available). */
export function codUnavailable(preview: Pick<CheckoutPreview, 'cod_available'> | null | undefined): boolean {
  return preview?.cod_available === false
}
