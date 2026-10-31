import type { FieldValues, Path, UseFormSetError } from 'react-hook-form'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api/client'

type Options = {
  /**
   * Keep dotted server paths ("variants.2.barcodes.0") instead of collapsing them to
   * their root field — for forms that render errors per array row.
   */
  nested?: boolean
}

/**
 * Maps a failed mutation onto a react-hook-form: VALIDATION_FAILED details become
 * field errors (dotted keys like "role_ids.0" collapse to their root field unless
 * `nested`); anything else is shown as a toast. Returns the user-facing message.
 */
export function handleFormError<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
  options: Options = {},
): string {
  if (error instanceof ApiError && error.code === 'VALIDATION_FAILED') {
    let mapped = false
    for (const [key, messages] of Object.entries(error.fieldErrors)) {
      const root = key.split('.')[0] as Path<T>
      if (fields.includes(root)) {
        setError((options.nested ? key : root) as Path<T>, { type: 'server', message: messages[0] })
        mapped = true
      }
    }
    if (mapped) {
      if (options.nested) toast.error('Please correct the highlighted fields.')
      return error.message
    }
  }

  const message = error instanceof Error ? error.message : 'Something went wrong.'
  toast.error(message)
  return message
}
