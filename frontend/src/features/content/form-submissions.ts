import { FORM_SUBMISSION_STATUSES, type FormSubmission, type FormSubmissionListParams, type FormSubmissionStatus, type FormSubmissionValue } from '@/features/content/forms-api'

/** Filters of /content/forms, kept in the address so a reload or a shared link shows the same list. */
export type FormSubmissionFilters = { form: string; status: FormSubmissionStatus | null; search: string; from: string; to: string; page: number }

const DATE = /^\d{4}-\d{2}-\d{2}$/

export function filtersFromSearchParams(params: URLSearchParams): FormSubmissionFilters {
  const status = params.get('status')
  const page = Number(params.get('page'))
  const date = (key: string) => {
    const value = params.get(key) ?? ''
    return DATE.test(value) ? value : ''
  }
  return {
    form: params.get('form') ?? '',
    status: FORM_SUBMISSION_STATUSES.includes(status as FormSubmissionStatus) ? (status as FormSubmissionStatus) : null,
    search: params.get('search') ?? '',
    from: date('from'),
    to: date('to'),
    page: Number.isInteger(page) && page > 1 ? page : 1,
  }
}

export function filtersToSearchParams(filters: FormSubmissionFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.form) params.set('form', filters.form)
  if (filters.status) params.set('status', filters.status)
  if (filters.search) params.set('search', filters.search)
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  if (filters.page > 1) params.set('page', String(filters.page))
  return params
}

/** The list request (and so the export query): empty filters are left out. */
export function toListParams(filters: FormSubmissionFilters, search: string = filters.search): FormSubmissionListParams {
  const params: FormSubmissionListParams = { page: filters.page }
  if (filters.form) params.form = filters.form
  if (filters.status) params.status = filters.status
  if (search.trim()) params.search = search.trim()
  if (filters.from) params.from = filters.from
  if (filters.to) params.to = filters.to
  return params
}

/** A submitted value as text: lists joined, ticks as Yes / No, nothing as a dash. */
export function formatSubmissionValue(value: FormSubmissionValue | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

/** "Name: Rahim · Phone: 017…" from the first answered fields, for the table. */
export function submissionSummary(submission: Pick<FormSubmission, 'fields' | 'values'>, count = 2, maxLength = 60): string {
  const parts: string[] = []
  for (const field of submission.fields) {
    const value = submission.values[field.id]
    if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) continue
    let text = formatSubmissionValue(value).replace(/\s+/g, ' ')
    if (text.length > maxLength) text = `${text.slice(0, maxLength - 1)}…`
    parts.push(`${field.label}: ${text}`)
    if (parts.length >= count) break
  }
  return parts.length ? parts.join(' · ') : 'No answers'
}

/** A `mailto:` link for the reply-to address, or null when it does not look like one address. */
export function replyMailto(submission: Pick<FormSubmission, 'reply_to' | 'form_title'>): string | null {
  const email = submission.reply_to?.trim()
  if (!email || !/^[^\s@,;?&]+@[^\s@,;?&]+\.[^\s@,;?&]+$/.test(email)) return null
  return `mailto:${email}?subject=${encodeURIComponent(`Re: ${submission.form_title}`)}`
}
