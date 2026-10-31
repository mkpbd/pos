/**
 * `<input type="datetime-local">` values edited in the organization's timezone (not the
 * browser's), converted to and from ISO 8601 instants with an explicit offset — the format
 * the API stores for schedules. Without a usable timezone they fall back to browser time.
 */
const pad = (n: number) => String(n).padStart(2, '0')
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

type Parts = { year: number; month: number; day: number; hour: number; minute: number }

function partsIn(date: Date, timeZone: string): Parts | null {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    const get = (type: string) => Number(fmt.formatToParts(date).find((p) => p.type === type)?.value)
    const parts = { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') % 24, minute: get('minute') }
    return Object.values(parts).every(Number.isFinite) ? parts : null
  } catch {
    return null
  }
}

/** Minutes the zone is ahead of UTC at that instant (Asia/Dhaka → 360). */
function offsetAt(timestamp: number, timeZone: string): number | null {
  const date = new Date(timestamp)
  const p = partsIn(date, timeZone)
  if (!p) return null
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute)
  const floored = timestamp - (((timestamp % 60_000) + 60_000) % 60_000)
  return Math.round((asUtc - floored) / 60_000)
}

function formatOffset(minutes: number): string {
  const sign = minutes >= 0 ? '+' : '-'
  const abs = Math.abs(minutes)
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

/** "2026-11-01T00:00:00Z" → "2026-11-01T06:00" for Asia/Dhaka; null → "". */
export function toZonedInput(iso: string | null | undefined, timeZone: string | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const p = timeZone ? partsIn(date, timeZone) : null
  if (!p) return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`
}

/** "2026-11-01T06:00" in Asia/Dhaka → "2026-11-01T06:00:00+06:00"; "" → null. */
export function fromZonedInput(value: string, timeZone: string | undefined): string | null {
  const m = LOCAL.exec(value)
  if (!m) return null
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number]
  const wall = Date.UTC(y, mo - 1, d, h, mi)

  let offset = timeZone ? offsetAt(wall, timeZone) : null
  if (offset === null) {
    const local = new Date(y, mo - 1, d, h, mi)
    offset = -local.getTimezoneOffset()
  } else {
    // The offset at the guessed instant may differ around a DST change; one correction settles it.
    const second = offsetAt(wall - offset * 60_000, timeZone as string)
    if (second !== null) offset = second
  }

  return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:00${formatOffset(offset)}`
}
