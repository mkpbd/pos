import { z } from 'zod'
import { BD_MOBILE, normalizeBdPhone } from '../account/schemas'
import type { CheckoutPreviewInput, Customer, CustomerAddress, GeoId, PaymentMethodCode, PlaceOrderInput } from '../types'

/** The "New address" choice of the address radio list (the other choices are address ids). */
export const NEW_ADDRESS = 'new'

const mobile = (empty: string) =>
  z
    .string()
    .trim()
    .min(1, empty)
    .refine((v) => BD_MOBILE.test(normalizeBdPhone(v)), 'Please enter a Bangladeshi mobile number, e.g. 01712345678.')

/**
 * The checkout form. Client checks give a quick answer; the server has the final say (its
 * 422 field errors land on these fields through SERVER_FIELDS). The inline address is only
 * checked when "New address" is chosen (always for guests).
 */
export const checkoutSchema = z
  .object({
    name: z.string().trim().min(2, 'Please enter your name.').max(120, 'Use at most 120 characters.'),
    email: z.string().trim().min(1, 'Please enter your e-mail address.').pipe(z.email('Please enter a valid e-mail address.')),
    phone: mobile('Please enter your mobile number.'),
    address_choice: z.string().min(1, 'Please choose a delivery address.'),
    recipient_name: z.string(),
    address_phone: z.string(),
    division_id: z.string(),
    district_id: z.string(),
    area: z.string(),
    address_line: z.string(),
    postcode: z.string(),
    save_address: z.boolean(),
    shipping_method_id: z.string().min(1, 'Please choose a delivery method.'),
    payment_method: z.string().refine((v) => v === 'cod' || v === 'bank_transfer', 'Please choose a payment method.'),
    notes: z.string().max(500, 'Use at most 500 characters.'),
  })
  .superRefine((values, ctx) => {
    if (values.address_choice !== NEW_ADDRESS) return
    const issue = (path: keyof typeof values, message: string) => ctx.addIssue({ code: 'custom', path: [path], message })
    const recipient = values.recipient_name.trim()
    if (recipient.length < 2) issue('recipient_name', 'Please enter the recipient’s name.')
    else if (recipient.length > 120) issue('recipient_name', 'Use at most 120 characters.')
    const phone = values.address_phone.trim()
    if (phone === '') issue('address_phone', 'Please enter a mobile number.')
    else if (!BD_MOBILE.test(normalizeBdPhone(phone))) issue('address_phone', 'Please enter a Bangladeshi mobile number, e.g. 01712345678.')
    if (values.division_id === '') issue('division_id', 'Please choose a division.')
    if (values.district_id === '') issue('district_id', 'Please choose a district.')
    const area = values.area.trim()
    if (area.length < 2) issue('area', 'Please enter the area or thana.')
    else if (area.length > 100) issue('area', 'Use at most 100 characters.')
    const line = values.address_line.trim()
    if (line.length < 3) issue('address_line', 'Please enter the street address.')
    else if (line.length > 255) issue('address_line', 'Use at most 255 characters.')
    if (values.postcode.trim() !== '' && !/^\d{4}$/.test(values.postcode.trim())) issue('postcode', 'A postcode has 4 digits.')
  })

export type CheckoutValues = z.input<typeof checkoutSchema>
export type CheckoutField = keyof CheckoutValues

/** The fields in the order they appear on the page (the first one with an error gets the focus). */
export const FIELD_ORDER: CheckoutField[] = [
  'name',
  'email',
  'phone',
  'address_choice',
  'recipient_name',
  'address_phone',
  'division_id',
  'district_id',
  'area',
  'address_line',
  'postcode',
  'save_address',
  'shipping_method_id',
  'payment_method',
  'notes',
]

/** Server field keys (422 details) → form fields. */
export const SERVER_FIELDS: Record<string, CheckoutField> = {
  'contact.name': 'name',
  'contact.email': 'email',
  'contact.phone': 'phone',
  shipping_address_id: 'address_choice',
  'address.recipient_name': 'recipient_name',
  'address.phone': 'address_phone',
  'address.division_id': 'division_id',
  'address.district_id': 'district_id',
  'address.area': 'area',
  'address.address_line': 'address_line',
  'address.postcode': 'postcode',
  address: 'address_line',
  save_address: 'save_address',
  shipping_method_id: 'shipping_method_id',
  payment_method: 'payment_method',
  notes: 'notes',
}

/** "address.district_id.0" → district_id; null for keys the form does not show. */
export function formFieldFor(serverKey: string): CheckoutField | null {
  const key = serverKey.replace(/\.\d+$/, '')
  return SERVER_FIELDS[key] ?? null
}

/** The starting values: the customer's contact details and default address, else empty. */
export function initialCheckoutValues(customer: Customer | null, addresses: CustomerAddress[] | undefined): CheckoutValues {
  const preferred = addresses?.find((a) => a.is_default_shipping) ?? addresses?.[0]
  return {
    name: customer?.name ?? '',
    email: customer?.email ?? '',
    phone: customer?.phone ?? '',
    address_choice: preferred ? preferred.id : NEW_ADDRESS,
    recipient_name: customer?.name ?? '',
    address_phone: customer?.phone ?? '',
    division_id: '',
    district_id: '',
    area: '',
    address_line: '',
    postcode: '',
    save_address: customer !== null,
    shipping_method_id: '',
    payment_method: '',
    notes: '',
  }
}

/** Ids go back to the server exactly as it sent them (number or string). */
export type GeoIdLookup = (kind: 'division' | 'district', value: string) => GeoId

const asIs: GeoIdLookup = (_kind, value) => value

/** The pricing part of the form for POST /store/checkout/preview (partial input is fine). */
export function toPreviewInput(values: Pick<CheckoutValues, 'address_choice' | 'division_id' | 'district_id' | 'shipping_method_id' | 'payment_method'>, geoId: GeoIdLookup = asIs): CheckoutPreviewInput {
  const input: CheckoutPreviewInput = {}
  if (values.address_choice && values.address_choice !== NEW_ADDRESS) input.shipping_address_id = values.address_choice
  else if (values.district_id) input.address = { division_id: geoId('division', values.division_id), district_id: geoId('district', values.district_id) }
  if (values.shipping_method_id) input.shipping_method_id = values.shipping_method_id
  if (values.payment_method) input.payment_method = values.payment_method as PaymentMethodCode
  return input
}

/** The body of POST /store/checkout from validated values and the total the shopper saw. */
export function toPlaceInput(values: CheckoutValues, expectedTotal: string, options: { signedIn: boolean; geoId?: GeoIdLookup }): PlaceOrderInput {
  const geoId = options.geoId ?? asIs
  const input: PlaceOrderInput = {
    contact: { name: values.name.trim(), email: values.email.trim(), phone: normalizeBdPhone(values.phone.trim()) },
    shipping_method_id: values.shipping_method_id,
    payment_method: values.payment_method as PaymentMethodCode,
    expected_total: expectedTotal,
  }
  if (options.signedIn && values.address_choice !== NEW_ADDRESS) {
    input.shipping_address_id = values.address_choice
  } else {
    input.address = {
      recipient_name: values.recipient_name.trim(),
      phone: normalizeBdPhone(values.address_phone.trim()),
      division_id: geoId('division', values.division_id),
      district_id: geoId('district', values.district_id),
      address_line: values.address_line.trim(),
    }
    if (values.area.trim()) input.address.area = values.area.trim()
    if (values.postcode.trim()) input.address.postcode = values.postcode.trim()
    if (options.signedIn) input.save_address = values.save_address
  }
  const notes = values.notes.trim()
  if (notes) input.notes = notes
  return input
}
