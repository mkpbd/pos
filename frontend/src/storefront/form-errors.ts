import { ApiError } from '@/lib/api/client'

/** A visitor-facing message for a failed storefront form submission. */
export function storeFormError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return 'Too many attempts. Please try again later.'
    if (error.code === 'VALIDATION_FAILED') return 'Please check the highlighted fields.'
    if (error.code === 'TOKEN_INVALID') return error.message
  }
  return 'Something went wrong. Please try again.'
}
