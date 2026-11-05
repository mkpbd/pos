import { ApiError } from '@/lib/api/client'
import type { ExportFormat } from '@/features/exports/lists'

const FORMAT_NAME: Record<ExportFormat, string> = { xlsx: 'Excel', pdf: 'PDF' }

function count(value: unknown): string | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  return Number.isFinite(n) ? n.toLocaleString('en-US') : null
}

/** Toast text for a failed export, by the server's error code (falls back to its message). */
export function exportErrorMessage(error: unknown, format: ExportFormat): string {
  if (!(error instanceof ApiError)) return 'The export failed. Please try again.'

  switch (error.code) {
    case 'EXPORT_TOO_LARGE': {
      const limit = count(error.details.limit)
      const rows = count(error.details.rows)
      const size = rows ? `This list has ${rows} rows` : 'This list is too long'
      const cap = limit ? `${FORMAT_NAME[format]} exports are limited to ${limit} rows` : `It is too long for a ${FORMAT_NAME[format]} export`
      return `${size}. ${cap} — narrow the filters and try again.`
    }
    case 'PDF_UNAVAILABLE':
      return 'PDF export is not available right now. Export to Excel instead, or ask your administrator to check the PDF renderer.'
    case 'NETWORK_ERROR':
      return 'Cannot reach the server. Check your connection.'
  }

  if (error.status === 403) return 'You do not have permission to export this list.'
  if (error.status === 429) return 'Too many exports in a short time. Wait a minute and try again.'
  if (error.status === 401) return 'Your session has expired. Sign in again to export.'
  if (error.code === 'INVALID_RESPONSE') return 'The server did not return a file. Please try again.'
  return error.message || 'The export failed. Please try again.'
}
