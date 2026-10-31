import { z } from 'zod'

/** Client-side checks for a quick answer; the server has the final say (422s map onto the fields). */
const email = z.string().trim().min(1, 'Please enter your e-mail address.').pipe(z.email('Please enter a valid e-mail address.'))
const newPassword = z.string().min(8, 'Use at least 8 characters.').max(255)

/** Bangladesh mobile number: 01XXXXXXXXX, also written with +88, spaces or dashes. */
export function normalizeBdPhone(input: string): string {
  return input.replace(/[\s-]/g, '').replace(/^\+?88(?=01)/, '')
}

export const BD_MOBILE = /^01[3-9]\d{8}$/

const optionalPhone = z
  .string()
  .trim()
  .refine((v) => v === '' || BD_MOBILE.test(normalizeBdPhone(v)), 'Please enter a Bangladeshi mobile number, e.g. 01712345678.')

const confirmed = <T extends { password: string; password_confirmation: string }>(v: T) => v.password === v.password_confirmation

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Please enter your password.'),
  remember: z.boolean(),
})
export type LoginValues = z.infer<typeof loginSchema>

export const registerSchema = z
  .object({
    name: z.string().trim().min(2, 'Please enter your name.').max(120),
    email,
    phone: optionalPhone,
    password: newPassword,
    password_confirmation: z.string(),
  })
  .refine(confirmed, { path: ['password_confirmation'], message: 'The passwords do not match.' })
export type RegisterValues = z.infer<typeof registerSchema>

export const forgotSchema = z.object({ email })
export type ForgotValues = z.infer<typeof forgotSchema>

export const resetSchema = z
  .object({ email, password: newPassword, password_confirmation: z.string() })
  .refine(confirmed, { path: ['password_confirmation'], message: 'The passwords do not match.' })
export type ResetValues = z.infer<typeof resetSchema>

export const profileSchema = z.object({
  name: z.string().trim().min(2, 'Please enter your name.').max(120),
  phone: optionalPhone,
})
export type ProfileValues = z.infer<typeof profileSchema>

export const passwordSchema = z
  .object({ current_password: z.string().min(1, 'Please enter your current password.'), password: newPassword, password_confirmation: z.string() })
  .refine(confirmed, { path: ['password_confirmation'], message: 'The passwords do not match.' })
export type PasswordValues = z.infer<typeof passwordSchema>

export const addressSchema = z.object({
  label: z.string().trim().max(40, 'Use at most 40 characters.'),
  recipient_name: z.string().trim().min(2, 'Please enter the recipient’s name.').max(120),
  phone: z
    .string()
    .trim()
    .min(1, 'Please enter a mobile number.')
    .refine((v) => BD_MOBILE.test(normalizeBdPhone(v)), 'Please enter a Bangladeshi mobile number, e.g. 01712345678.'),
  division_id: z.string().min(1, 'Please choose a division.'),
  district_id: z.string().min(1, 'Please choose a district.'),
  area: z.string().trim().min(2, 'Please enter the area or thana.').max(100, 'Use at most 100 characters.'),
  address_line: z.string().trim().min(3, 'Please enter the street address.').max(255, 'Use at most 255 characters.'),
  postcode: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d{4}$/.test(v), 'A postcode has 4 digits.'),
  is_default_shipping: z.boolean(),
  is_default_billing: z.boolean(),
})
export type AddressValues = z.infer<typeof addressSchema>
