/**
 * Conversions between API timestamps (ISO 8601 with offset) and `<input type="datetime-local">`
 * values, which carry no zone: the admin edits in the browser's local time.
 */
const pad = (n: number) => String(n).padStart(2, '0')

/** "2026-11-01T00:00:00+06:00" → "2026-11-01T00:00" in local time; null → "". */
export function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** "2026-11-01T00:00" (local) → "2026-11-01T00:00:00+06:00" with the browser's offset at that moment; "" → null. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  const offset = -d.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const abs = Math.abs(offset)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}
