import type { MessageKey } from '../../i18n/en'
import type { FormField, FormFieldKind, FormSubmitValue } from '../types'
import { B8B_ENUMS, FORM_OPTION_KINDS, isEmailAddress, ITEM_ID, oneOf } from '../validate'
import { isObject, str } from './shared'

/*
 * B8b form element: the visitor's answers, checked in the browser the way the server checks them
 * (contract §2) so most mistakes are caught before sending. The server decides.
 */

/** One answer per field id: text kinds a string, checkbox a boolean, checkboxes option ids. */
export type FormValues = Record<string, string | boolean | string[]>

/** Default lengths when `max_length` is null (the server's: 255 for text, 2000 for a textarea). */
export const DEFAULT_MAX_LENGTH = { text: 255, textarea: 2000 } as const

const PHONE = /^\+?[0-9০-৯][0-9০-৯\s().-]{5,24}$/
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

export function isPhoneNumber(value: string): boolean {
  return PHONE.test(value.trim()) && value.replace(/[^0-9০-৯]/g, '').length >= 6
}

export function maxLengthOf(field: Pick<FormField, 'kind' | 'max_length'>): number | undefined {
  if (field.kind === 'text') return field.max_length ?? DEFAULT_MAX_LENGTH.text
  if (field.kind === 'textarea') return field.max_length ?? DEFAULT_MAX_LENGTH.textarea
  if (field.kind === 'email') return 254
  if (field.kind === 'phone') return 30
  return undefined
}

export function initialValues(fields: readonly FormField[]): FormValues {
  return Object.fromEntries(fields.map((field) => [field.id, field.kind === 'checkbox' ? false : field.kind === 'checkboxes' ? [] : '']))
}

export type FieldError = { key: MessageKey; params?: Record<string, string | number> }

function isEmpty(value: FormValues[string] | undefined): boolean {
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'boolean') return !value
  return (value ?? '').trim() === ''
}

/** The problem with one answer, or null. */
export function fieldError(field: FormField, value: FormValues[string] | undefined): FieldError | null {
  const choice = field.kind === 'select' || field.kind === 'radio' || field.kind === 'checkboxes'
  if (isEmpty(value)) return field.required ? { key: choice || field.kind === 'checkbox' ? 'content.builder.form.errorChoose' : 'content.builder.form.errorRequired', params: { label: field.label } } : null
  const optionIds = new Set(field.options.map((option) => option.id))
  if (field.kind === 'checkboxes') return Array.isArray(value) && value.every((id) => optionIds.has(id)) ? null : { key: 'content.builder.form.errorChoose', params: { label: field.label } }
  if (field.kind === 'checkbox') return null
  const text = typeof value === 'string' ? value.trim() : ''
  switch (field.kind) {
    case 'email':
      return isEmailAddress(text) ? null : { key: 'content.builder.form.errorEmail' }
    case 'phone':
      return isPhoneNumber(text) ? null : { key: 'content.builder.form.errorPhone' }
    case 'number': {
      const number = Number(text)
      if (!/^-?\d+(\.\d+)?$/.test(text) || !Number.isFinite(number)) return { key: 'content.builder.form.errorNumber' }
      if (field.min !== null && number < field.min) return { key: 'content.builder.form.errorMin', params: { min: field.min } }
      if (field.max !== null && number > field.max) return { key: 'content.builder.form.errorMax', params: { max: field.max } }
      return null
    }
    case 'date':
      return DATE.test(text) ? null : { key: 'content.builder.form.errorDate' }
    case 'select':
    case 'radio':
      return optionIds.has(text) ? null : { key: 'content.builder.form.errorChoose', params: { label: field.label } }
    default: {
      const max = maxLengthOf(field)
      return max !== undefined && text.length > max ? { key: 'content.builder.form.errorLength', params: { max } } : null
    }
  }
}

/** Every field's problem (field id → error); empty = ready to send. */
export function formErrors(fields: readonly FormField[], values: FormValues): Record<string, FieldError> {
  const errors: Record<string, FieldError> = {}
  for (const field of fields) {
    const error = fieldError(field, values[field.id])
    if (error) errors[field.id] = error
  }
  return errors
}

/** The `values` of the submit request: trimmed text, numbers as numbers; unanswered fields are left out. */
export function submitValues(fields: readonly FormField[], values: FormValues): Record<string, FormSubmitValue> {
  const out: Record<string, FormSubmitValue> = {}
  for (const field of fields) {
    const value = values[field.id]
    if (field.kind === 'checkbox') out[field.id] = value === true
    else if (Array.isArray(value)) {
      if (value.length > 0) out[field.id] = [...value]
    } else if (typeof value === 'string' && value.trim() !== '') out[field.id] = field.kind === 'number' ? Number(value.trim()) : value.trim()
  }
  return out
}

/** The fields of the payload, checked again (the renderer never trusts their shape). */
export function readFields(value: unknown): FormField[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: FormField[] = []
  for (const item of value) {
    if (!isObject(item) || typeof item.id !== 'string' || !ITEM_ID.test(item.id) || seen.has(item.id)) continue
    const kind = oneOf(item.kind, B8B_ENUMS.formFieldKind) as FormFieldKind | undefined
    if (!kind) continue
    seen.add(item.id)
    const options = FORM_OPTION_KINDS.includes(kind) && Array.isArray(item.options) ? item.options.filter((o): o is { id: string; label: string } => isObject(o) && typeof o.id === 'string' && ITEM_ID.test(o.id) && typeof o.label === 'string') : []
    const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null)
    out.push({
      id: item.id,
      kind,
      label: str(item.label),
      placeholder: str(item.placeholder),
      help: str(item.help),
      required: item.required === true,
      options,
      min: kind === 'number' ? num(item.min) : null,
      max: kind === 'number' ? num(item.max) : null,
      max_length: kind === 'text' || kind === 'textarea' ? num(item.max_length) : null,
      reply_to: kind === 'email' && item.reply_to === true,
    })
  }
  return out
}
