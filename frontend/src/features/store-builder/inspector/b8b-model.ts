/*
 * B8b: pure helpers of the form builder (the `form` element's Content tab): the field kinds in
 * plain words with their icons, what a kind change keeps, and the single reply-to field.
 */

import {
  AtSignIcon,
  CalendarIcon,
  CircleDotIcon,
  HashIcon,
  ListChecksIcon,
  PhoneIcon,
  SquareCheckIcon,
  SquareChevronDownIcon,
  TextIcon,
  TypeIcon,
  type LucideIcon,
} from 'lucide-react'
import { FORM_CHOICE_KINDS, formFieldDefaults } from '@/storefront/builder/registry'
import type { FormField as FormFieldValue, FormFieldKind } from '@/storefront/builder/types'
import { B8B_LIMITS } from '@/storefront/builder/validate'

/** The field kinds in plain words, with an icon each (the kind picker and the list cards). */
export const FORM_FIELD_KINDS: { kind: FormFieldKind; label: string; hint: string; icon: LucideIcon }[] = [
  { kind: 'text', label: 'Short text', hint: 'A name, a city — one line.', icon: TypeIcon },
  { kind: 'email', label: 'E-mail', hint: 'Checked to look like an e-mail address.', icon: AtSignIcon },
  { kind: 'phone', label: 'Phone number', hint: 'Opens the number keypad on phones.', icon: PhoneIcon },
  { kind: 'textarea', label: 'Long text', hint: 'A message or a question — several lines.', icon: TextIcon },
  { kind: 'number', label: 'Number', hint: 'How many, a size, an age.', icon: HashIcon },
  { kind: 'select', label: 'Drop-down list', hint: 'Pick one from a list that opens.', icon: SquareChevronDownIcon },
  { kind: 'radio', label: 'Choose one', hint: 'Pick one; all choices are visible.', icon: CircleDotIcon },
  { kind: 'checkbox', label: 'Tick box', hint: 'One box: yes or no.', icon: SquareCheckIcon },
  { kind: 'checkboxes', label: 'Choose several', hint: 'Tick any number of choices.', icon: ListChecksIcon },
  { kind: 'date', label: 'Date', hint: 'A day from a calendar.', icon: CalendarIcon },
]

export const KIND_INFO = Object.fromEntries(FORM_FIELD_KINDS.map((k) => [k.kind, k])) as Record<FormFieldKind, (typeof FORM_FIELD_KINDS)[number]>

export const isChoice = (kind: FormFieldKind) => FORM_CHOICE_KINDS.includes(kind)
/** Kinds that show an example inside the box (a drop-down shows it before a choice is made). */
export const hasPlaceholder = (kind: FormFieldKind) => !['radio', 'checkbox', 'checkboxes', 'date'].includes(kind)

/**
 * A field after its kind changed: choices for the choice kinds (kept when it had some), and the
 * number range / longest answer / reply-to only where they apply.
 */
export function withKind(field: FormFieldValue, kind: FormFieldKind): FormFieldValue {
  const fresh = formFieldDefaults(field.id, kind, field.label)
  return {
    ...field,
    kind,
    placeholder: hasPlaceholder(kind) ? field.placeholder : '',
    options: isChoice(kind) ? (field.options.length >= B8B_LIMITS.formOptions.min ? field.options : fresh.options) : [],
    min: kind === 'number' ? field.min : null,
    max: kind === 'number' ? field.max : null,
    max_length: kind === 'text' || kind === 'textarea' ? field.max_length : null,
    reply_to: kind === 'email' ? field.reply_to : false,
  }
}

/** At most one reply-to e-mail field: the first one keeps it (a duplicated field doesn't take it). */
export function oneReplyTo(fields: FormFieldValue[], keep?: string): FormFieldValue[] {
  const owner = (keep ? fields.find((f) => f.id === keep && f.reply_to) : undefined) ?? fields.find((f) => f.reply_to)
  return fields.map((f) => (f.reply_to && f !== owner ? { ...f, reply_to: false } : f))
}

