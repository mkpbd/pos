import type { Rect } from '@/storefront/builder/canvas/protocol'
import type { ActivityEntry, BuilderComment, CommentAnchor, DocumentLock, Person, Viewer } from './collab-api'

/*
 * B16 pure helpers: who is on the page (initials, colours, words), where a comment pin goes, the
 * @mention being typed, and activity entries in plain words.
 */

/* ---------------------------------------------------------------- people ----------------------- */

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = Array.from(parts[0]!)[0] ?? ''
  const last = parts.length > 1 ? (Array.from(parts[parts.length - 1]!)[0] ?? '') : ''
  return (first + last).toUpperCase()
}

/** Avatar backgrounds, each ≥ 4.5:1 with white text. */
export const AVATAR_COLORS = ['bg-blue-700', 'bg-emerald-700', 'bg-violet-700', 'bg-rose-700', 'bg-amber-800', 'bg-teal-700', 'bg-indigo-700', 'bg-fuchsia-700'] as const

/** The same person always gets the same colour. */
export function avatarColor(id: string): (typeof AVATAR_COLORS)[number] {
  let hash = 0
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!
}

/** The other people on the page (one entry per person; the editor first). */
export function otherViewers(viewers: readonly Viewer[], meId: string | null): Viewer[] {
  const seen = new Map<string, Viewer>()
  for (const viewer of viewers) {
    if (viewer.is_me || (meId !== null && viewer.user.id === meId)) continue
    const known = seen.get(viewer.user.id)
    if (!known || (viewer.editing && !known.editing)) seen.set(viewer.user.id, viewer)
  }
  return [...seen.values()].sort((a, b) => Number(b.editing) - Number(a.editing) || a.user.name.localeCompare(b.user.name))
}

/** Whether the lease has run out (anyone who can edit may then take over). */
export function lockExpired(lock: DocumentLock | null, now: number = Date.now()): boolean {
  if (!lock?.expires_at) return false
  const at = Date.parse(lock.expires_at)
  return Number.isFinite(at) && at <= now
}

/* ---------------------------------------------------------------- pins ------------------------- */

/** The smallest drawn rect that holds the point (null: none) — the part of the page clicked on. */
export function hitNode(rects: Record<string, Rect>, point: { x: number; y: number }, accept: (id: string) => boolean = () => true): string | null {
  let best: { id: string; area: number } | null = null
  for (const [id, r] of Object.entries(rects)) {
    if (r.w <= 0 || r.h <= 0) continue
    if (point.x < r.x || point.x > r.x + r.w || point.y < r.y || point.y > r.y + r.h) continue
    if (!accept(id)) continue
    const area = r.w * r.h
    if (!best || area < best.area) best = { id, area }
  }
  return best?.id ?? null
}

const round = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000

/** Where in the rect the point is, 0–1 each way. */
export function anchorIn(rect: Rect, point: { x: number; y: number }): CommentAnchor {
  return { x: round(rect.w > 0 ? (point.x - rect.x) / rect.w : 0.5), y: round(rect.h > 0 ? (point.y - rect.y) / rect.h : 0.5) }
}

/** A comment added from the keyboard ("C") sits near the selected part's top right corner. */
export const KEYBOARD_ANCHOR: CommentAnchor = { x: 0.96, y: 0.04 }

/** A pin's point in canvas pixels. */
export function pinPoint(rect: Rect, anchor: CommentAnchor | null): { x: number; y: number } {
  const a = anchor ?? KEYBOARD_ANCHOR
  return { x: rect.x + a.x * rect.w, y: rect.y + a.y * rect.h }
}

/** The number a thread's pin shows (the server's, else its place among the threads, oldest first). */
export function threadNumbers(threads: readonly BuilderComment[]): Map<string, number> {
  const sorted = [...threads].sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))
  const result = new Map<string, number>()
  sorted.forEach((thread, index) => result.set(thread.id, thread.number ?? index + 1))
  return result
}

export const isOpen = (thread: BuilderComment) => thread.resolved_at === null

/** Whether the author may still change the comment (15 minutes; the server has the last word). */
export function canStillEdit(comment: BuilderComment, now: number = Date.now(), windowMs = 15 * 60_000): boolean {
  if (!comment.can_edit) return false
  const at = comment.created_at ? Date.parse(comment.created_at) : NaN
  return !Number.isFinite(at) || now - at < windowMs
}

/* ---------------------------------------------------------------- mentions --------------------- */

/** The `@name` being typed just before the caret: where it starts and what is typed after `@`. */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const match = /(^|\s)@([\p{L}\p{N}._-]{0,30})$/u.exec(before)
  if (!match) return null
  const start = before.length - match[2]!.length - 1
  return { start, query: match[2]! }
}

/** Puts `@Name ` in place of the `@query` being typed; returns the text and the caret after it. */
export function insertMention(text: string, at: { start: number; query: string }, name: string): { text: string; caret: number } {
  const insert = `@${name} `
  const end = at.start + 1 + at.query.length
  const rest = text.slice(end).replace(/^ /, '')
  return { text: text.slice(0, at.start) + insert + rest, caret: at.start + insert.length }
}

/** The people picked from the list whose `@Name` is still in the text. */
export function mentionedIds(text: string, picked: readonly Person[]): string[] {
  const ids = new Set<string>()
  for (const person of picked) if (text.includes(`@${person.name}`)) ids.add(person.id)
  return [...ids]
}

/** Splits a comment into text and @mention parts (the mentions as the server resolved them). */
export function mentionParts(body: string, mentions: readonly Person[]): { text: string; mention: boolean }[] {
  const names = [...new Set(mentions.map((m) => m.name))].sort((a, b) => b.length - a.length)
  if (names.length === 0) return [{ text: body, mention: false }]
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const pattern = new RegExp(`@(?:${escaped.join('|')})`, 'gu')
  const parts: { text: string; mention: boolean }[] = []
  let last = 0
  for (const match of body.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > last) parts.push({ text: body.slice(last, index), mention: false })
    parts.push({ text: match[0], mention: true })
    last = index + match[0].length
  }
  if (last < body.length) parts.push({ text: body.slice(last), mention: false })
  return parts
}

/* ---------------------------------------------------------------- activity --------------------- */

const ACTION_WORDS: Record<string, string> = {
  created: 'created the page',
  renamed: 'renamed the page',
  published: 'published the page',
  unpublished: 'took the page off the store',
  scheduled: 'planned a publish',
  schedule_cancelled: 'cancelled the planned publish',
  schedule_failed: 'The planned publish could not go live',
  review_submitted: 'sent the draft for approval',
  review_approved: 'approved the draft',
  review_sent_back: 'sent the draft back',
  review_withdrawn: 'withdrew the approval request',
  checkpoint_saved: 'saved a named copy',
  version_restored: 'restored a version to the draft',
  restored: 'restored a version to the draft',
  discarded: 'discarded the draft changes',
  lock_taken_over: 'took over editing',
  comment_resolved: 'resolved a comment',
  imported: 'imported a copy into the draft',
  exported: 'downloaded a copy',
  address_changed: 'changed the page address',
}

/** The action name without its module prefix (`storefront.builder_published` → `published`). */
export function plainAction(action: string): string {
  return action.replace(/^storefront\.builder_/, '').replace(/^storefront\./, '').replace(/^builder_/, '')
}

function clock(iso: unknown, timeZone?: string): string | null {
  if (typeof iso !== 'string') return null
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  try {
    return at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...(timeZone ? { timeZone } : {}) })
  } catch {
    return at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }
}

/** "3:10–3:40 PM" (one AM / PM when both share it). */
export function timeRange(from: unknown, to: unknown, timeZone?: string): string | null {
  const a = clock(from, timeZone)
  const b = clock(to, timeZone)
  if (!a || !b) return a ?? b
  if (a === b) return a
  const suffix = / (AM|PM)$/.exec(a)?.[1]
  return suffix && b.endsWith(suffix) ? `${a.slice(0, -suffix.length - 1)}–${b}` : `${a}–${b}`
}

/** An activity entry in plain words, after the person's name ("edited the draft (12 saves, 3:10–3:40 PM)"). */
export function activityWords(entry: ActivityEntry, timeZone?: string): string {
  const action = plainAction(entry.action)
  if (action === 'edited') {
    const saves = Number(entry.details.saves)
    const range = timeRange(entry.details.started_at, entry.details.ended_at, timeZone)
    const bits = [Number.isFinite(saves) && saves > 0 ? `${saves} ${saves === 1 ? 'save' : 'saves'}` : null, range].filter(Boolean)
    return `edited the draft${bits.length > 0 ? ` (${bits.join(', ')})` : ''}`
  }
  let summary = entry.summary.trim()
  // "Rima published version 4" → "published version 4" (the name is shown before it).
  if (entry.user && summary.startsWith(`${entry.user.name} `)) summary = summary.slice(entry.user.name.length + 1)
  if (entry.user && /^\p{Lu}\p{Ll}/u.test(summary)) summary = summary.charAt(0).toLowerCase() + summary.slice(1)
  if (summary !== '') return summary
  return ACTION_WORDS[action] ?? action.replace(/_/g, ' ')
}

/** The version an entry is about (published, restored …), for "See version N". */
export function activityVersion(entry: ActivityEntry): { id: string; number: number | null } | null {
  const id = entry.details.version_id
  if (typeof id !== 'string' && typeof id !== 'number') return null
  const number = Number(entry.details.version_number)
  return { id: String(id), number: Number.isFinite(number) && number > 0 ? number : null }
}
