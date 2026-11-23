import { ApiError } from '@/lib/api/client'

/** Digits only, at most 6 — authenticator apps often show "123 456". */
export function sanitizeCode(value: string): string {
  return value.replace(/\D/g, '').slice(0, 6)
}

export function isSixDigitCode(value: string): boolean {
  return /^\d{6}$/.test(value)
}

/** "JBSW Y3DP EHPK 3PXP" — easier to read out and type than one long string. */
export function groupKey(secret: string): string {
  return (secret.match(/.{1,4}/g) ?? []).join(' ')
}

/** The first server field error for `field` (VALIDATION_FAILED), else the error's own message. */
export function serverMessage(error: unknown, field?: string): string {
  if (error instanceof ApiError) {
    if (field && error.code === 'VALIDATION_FAILED') return error.fieldErrors[field]?.[0] ?? error.message
    return error.message
  }
  return error instanceof Error ? error.message : 'Something went wrong.'
}

/** Props of every 6-digit code input: numeric keypad on phones, one-time-code autofill. */
export const CODE_INPUT_PROPS = {
  inputMode: 'numeric',
  autoComplete: 'one-time-code',
  pattern: '[0-9]*',
  maxLength: 6,
  className: 'font-mono tracking-[0.3em]',
} as const
