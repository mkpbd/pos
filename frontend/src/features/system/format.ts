import { useEffect, useState } from 'react'
import type { Count } from '@/features/system/api'

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']

/** Bigint values may come as numbers or numeric strings; anything else is null. */
export function toNumber(value: Count | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

/** "512 B", "340 KB", "1.2 GB" (binary units, one decimal below 10). */
export function formatBytes(value: Count | null | undefined): string {
  const bytes = toNumber(value)
  if (bytes === null) return '—'
  if (bytes < 1024) return `${bytes} B`
  let size = bytes
  let unit = 0
  while (size >= 1024 && unit < UNITS.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size < 10 ? size.toFixed(1) : Math.round(size)} ${UNITS[unit]}`
}

/** "just now", "2 min ago", "3 h ago", "yesterday", "5 days ago"; a time slightly ahead (clock skew) reads "just now". */
export function formatRelative(iso: string | null | undefined, now: number): string {
  if (!iso) return 'never'
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return '—'
  const seconds = Math.round((now - then) / 1000)
  if (seconds < 0) return seconds > -120 ? 'just now' : `in ${formatSpan(-seconds)}`
  if (seconds < 45) return 'just now'
  if (seconds >= 86_400 && seconds < 2 * 86_400) return 'yesterday'
  return `${formatSpan(seconds)} ago`
}

function formatSpan(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h`
  const days = Math.round(hours / 24)
  return `${days} ${days === 1 ? 'day' : 'days'}`
}

/** Full local date and time, for titles and detail views. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}

/** "1,234" */
export function formatCount(value: Count | null | undefined): string {
  const n = toNumber(value)
  return n === null ? '—' : n.toLocaleString('en-US')
}

/** The current time, ticking every `intervalMs` so relative times stay fresh (no network involved). */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}
