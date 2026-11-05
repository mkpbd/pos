import type { FieldValues, Path, UseFormSetError } from 'react-hook-form'
import { ApiError } from '@/lib/api/client'
import type { Translate } from './i18n/translate'

/** A visitor-facing message for a failed storefront form submission. */
export function storeFormError(error: unknown, t: Translate): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return t('common.form.tooManyAttempts')
    if (error.code === 'VALIDATION_FAILED') return t('common.form.checkFields')
    // English shows the server's own wording (which link: verification, reset, newsletter).
    if (error.code === 'TOKEN_INVALID') return t('common.form.linkInvalid', { server: error.message })
    if (error.code === 'INVALID_CREDENTIALS') return t('common.form.invalidCredentials')
    if (error.status === 419) return t('common.form.sessionExpired')
    if (error.status === 401) return t('common.form.signInAgain')
  }
  return t('common.genericError')
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
