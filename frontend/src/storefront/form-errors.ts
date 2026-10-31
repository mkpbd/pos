import type { FieldValues, Path, UseFormSetError } from 'react-hook-form'
import { ApiError } from '@/lib/api/client'

/** A visitor-facing message for a failed storefront form submission. */
export function storeFormError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return 'Too many attempts. Please try again later.'
    if (error.code === 'VALIDATION_FAILED') return 'Please check the highlighted fields.'
    if (error.code === 'TOKEN_INVALID') return error.message
    if (error.code === 'INVALID_CREDENTIALS') return 'The e-mail address or password is incorrect.'
    if (error.status === 419) return 'Your session expired. Please try again.'
    if (error.status === 401) return 'Please sign in again.'
  }
  return 'Something went wrong. Please try again.'
}

/**
 * Puts the field errors of a 422 VALIDATION_FAILED onto a react-hook-form ("division_id.0" →
 * "division_id"). Returns true when at least one listed field got an error; any other failure
 * is left to a form-level message (storeFormError).
 */
export function applyServerErrors<T extends FieldValues>(error: unknown, setError: UseFormSetError<T>, fields: readonly Path<T>[], aliases: Record<string, Path<T>> = {}): boolean {
  if (!(error instanceof ApiError) || error.code !== 'VALIDATION_FAILED') return false
  let mapped = false
  for (const [key, messages] of Object.entries(error.fieldErrors)) {
    const root = key.split('.')[0] ?? key
    const field = aliases[root] ?? (root as Path<T>)
    if (fields.includes(field) && messages[0]) {
      setError(field, { type: 'server', message: messages[0] }, { shouldFocus: !mapped })
      mapped = true
    }
  }
  return mapped
}
