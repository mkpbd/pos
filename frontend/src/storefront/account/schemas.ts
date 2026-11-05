import { z } from 'zod'

/**
 * Client-side checks for a quick answer; the server has the final say (422s map onto the fields).
 * Messages are dictionary keys (ADR-011): TextField and the address selects show them through
 * translateMessage(), with the field's maxLength as `{max}`.
 */
const email = z.string().trim().min(1, 'account.validation.emailRequired').pipe(z.email('account.validation.emailInvalid'))
const newPassword = z.string().min(8, 'account.validation.passwordMin').max(255)

/** Bangladesh mobile number: 01XXXXXXXXX, also written with +88, spaces or dashes. */
export function normalizeBdPhone(input: string): string {
  return input.replace(/[\s-]/g, '').replace(/^\+?88(?=01)/, '')
}

export const BD_MOBILE = /^01[3-9]\d{8}$/

const optionalPhone = z
  .string()
  .trim()
  .refine((v) => v === '' || BD_MOBILE.test(normalizeBdPhone(v)), 'account.validation.phoneInvalid')

const confirmed = <T extends { password: string; password_confirmation: string }>(v: T) => v.password === v.password_confirmation

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'account.validation.passwordRequired'),
  remember: z.boolean(),
})
export type LoginValues = z.infer<typeof loginSchema>

export const registerSchema = z
  .object({
    name: z.string().trim().min(2, 'account.validation.nameRequired').max(120),
    email,
    phone: optionalPhone,
    password: newPassword,
    password_confirmation: z.string(),
  })
  .refine(confirmed, { path: ['password_confirmation'], message: 'account.validation.passwordsMismatch' })
export type RegisterValues = z.infer<typeof registerSchema>

export const forgotSchema = z.object({ email })
export type ForgotValues = z.infer<typeof forgotSchema>

export const resetSchema = z
  .object({ email, password: newPassword, password_confirmation: z.string() })
  .refine(confirmed, { path: ['password_confirmation'], message: 'account.validation.passwordsMismatch' })
export type ResetValues = z.infer<typeof resetSchema>

export const profileSchema = z.object({
  name: z.string().trim().min(2, 'account.validation.nameRequired').max(120),
  phone: optionalPhone,
})
export type ProfileValues = z.infer<typeof profileSchema>

export const passwordSchema = z
  .object({ current_password: z.string().min(1, 'account.validation.currentPasswordRequired'), password: newPassword, password_confirmation: z.string() })
  .refine(confirmed, { path: ['password_confirmation'], message: 'account.validation.passwordsMismatch' })
export type PasswordValues = z.infer<typeof passwordSchema>

export const addressSchema = z.object({
  label: z.string().trim().max(40, 'account.validation.maxChars'),
  recipient_name: z.string().trim().min(2, 'account.validation.recipientRequired').max(120),
  phone: z
    .string()
    .trim()
    .min(1, 'account.validation.mobileRequired')
    .refine((v) => BD_MOBILE.test(normalizeBdPhone(v)), 'account.validation.phoneInvalid'),
  division_id: z.string({ error: 'account.validation.divisionRequired' }).min(1, 'account.validation.divisionRequired'),
  district_id: z.string({ error: 'account.validation.districtRequired' }).min(1, 'account.validation.districtRequired'),
  area: z.string().trim().min(2, 'account.validation.areaRequired').max(100, 'account.validation.maxChars'),
  address_line: z.string().trim().min(3, 'account.validation.streetRequired').max(255, 'account.validation.maxChars'),
  postcode: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d{4}$/.test(v), 'account.validation.postcodeInvalid'),
  is_default_shipping: z.boolean(),
  is_default_billing: z.boolean(),
})
export type AddressValues = z.infer<typeof addressSchema>
