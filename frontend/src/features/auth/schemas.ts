import { z } from 'zod'

// Mirrors Password::defaults() outside production (min 8, letters + numbers); the server has the final say.
export const passwordRule = z
  .string()
  .min(8, 'At least 8 characters.')
  .regex(/[A-Za-z]/, 'Include at least one letter.')
  .regex(/\d/, 'Include at least one number.')

export const loginSchema = z.object({
  email: z.email('Enter a valid e-mail address.'),
  password: z.string().min(1, 'Enter your password.'),
  remember: z.boolean(),
})
export type LoginValues = z.infer<typeof loginSchema>

export const registerSchema = z
  .object({
    organization_name: z.string().trim().min(2, 'Enter your business name.').max(255),
    branch_name: z.string().trim().max(255).optional(),
    name: z.string().trim().min(2, 'Enter your name.').max(255),
    email: z.email('Enter a valid e-mail address.'),
    password: passwordRule,
    password_confirmation: z.string(),
  })
  .refine((v) => v.password === v.password_confirmation, { path: ['password_confirmation'], message: 'Passwords do not match.' })
export type RegisterValues = z.infer<typeof registerSchema>

export const forgotPasswordSchema = z.object({ email: z.email('Enter a valid e-mail address.') })
export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>

export const resetPasswordSchema = z
  .object({ password: passwordRule, password_confirmation: z.string() })
  .refine((v) => v.password === v.password_confirmation, { path: ['password_confirmation'], message: 'Passwords do not match.' })
export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>

export const changePasswordSchema = z
  .object({ current_password: z.string().min(1, 'Enter your current password.'), password: passwordRule, password_confirmation: z.string() })
  .refine((v) => v.password === v.password_confirmation, { path: ['password_confirmation'], message: 'Passwords do not match.' })
  .refine((v) => v.password !== v.current_password, { path: ['password'], message: 'Choose a different password.' })
export type ChangePasswordValues = z.infer<typeof changePasswordSchema>
