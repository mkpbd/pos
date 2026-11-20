import { ApiError, api, API_BASE, type ApiFailure } from '@/lib/api/client'
import { saveBlob } from '@/lib/api/download'

/*
 * B16 teamwork & safety — the editor's side of the builder collaboration API (one file, typed):
 *  - presence + edit lock: POST / DELETE …/documents/{id}/presence, POST …/lock/take-over, …/lock/request;
 *  - comments pinned on the page: GET / POST …/comments, PATCH / DELETE …/comments/{c}, POST …/resolve | reopen;
 *  - people to @mention (staff who can view the store builder);
 *  - the page's activity (audit + edit sessions), paged with `before`;
 *  - "Download a copy (.json)": GET …/export.
 * Polling only (no websockets). Readers are lenient: a field the server leaves out gets a safe default.
 */

const BASE = '/storefront/builder'
const doc = (id: string) => `${BASE}/documents/${encodeURIComponent(id)}`

export const collabKeys = {
  comments: (id: string) => ['store-builder', 'documents', id, 'comments'] as const,
  activity: (id: string) => ['store-builder', 'documents', id, 'activity'] as const,
  mentionable: (q: string) => ['store-builder', 'mentionable', q] as const,
}

/** How often the editor says "I'm here" (and comments are fetched again). */
export const HEARTBEAT_MS = 20_000

export type Person = { id: string; name: string }

/* ---------------------------------------------------------------- presence & lock -------------- */

export type Viewer = { user: Person; editing: boolean; since: string | null; last_seen: string | null; is_me: boolean }

export type DocumentLock = { user: Person; acquired_at: string | null; expires_at: string | null }

export type Presence = {
  viewers: Viewer[]
  lock: DocumentLock | null
  /** The lock is this user's. */
  mine: boolean
  /** The draft's current revision (when the server sends it): a read-only editor refreshes when it changed. */
  draft_revision?: number | null
  /** Open comments and when any comment last changed: the editor fetches comments again only on a change. */
  comments: { open: number; updated_at: string | null } | null
}

function person(value: unknown): Person | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as { id?: unknown; name?: unknown }
  if (v.id === undefined || v.id === null) return null
  return { id: String(v.id), name: typeof v.name === 'string' && v.name.trim() !== '' ? v.name : 'Someone' }
}

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)

/** Reads a presence answer leniently. */
export function readPresence(value: unknown): Presence {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const viewers: Viewer[] = []
  for (const entry of Array.isArray(raw.viewers) ? raw.viewers : []) {
    const e = (entry ?? {}) as Record<string, unknown>
    const user = person(e.user)
    if (user) viewers.push({ user, editing: e.editing === true, since: text(e.since), last_seen: text(e.last_seen), is_me: e.is_me === true })
  }
  const lockRaw = raw.lock as Record<string, unknown> | null | undefined
  const lockUser = lockRaw ? person(lockRaw.user) : null
  const lock: DocumentLock | null = lockRaw && lockUser ? { user: lockUser, acquired_at: text(lockRaw.acquired_at), expires_at: text(lockRaw.expires_at) } : null
  const comments = raw.comments as { open?: unknown; updated_at?: unknown } | null | undefined
  return {
    viewers,
    lock,
    mine: raw.mine === true,
    draft_revision: typeof raw.draft_revision === 'number' ? raw.draft_revision : null,
    comments: comments && typeof comments === 'object' ? { open: Number(comments.open) || 0, updated_at: text(comments.updated_at) } : null,
  }
}

/** The heartbeat: every 20 s while the editor is open (and on focus). `editing` asks for / renews the lock. */
export async function sendPresence(documentId: string, editing: boolean, signal?: AbortSignal): Promise<Presence> {
  return readPresence((await api.post<unknown>(`${doc(documentId)}/presence`, { editing }, { signal })).data)
}

function readCookie(name: string): string | null {
  const match = document.cookie.split('; ').find((row) => row.startsWith(`${name}=`))
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null
}

function headers(json = false): Record<string, string> {
  const result: Record<string, string> = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
  if (json) result['Content-Type'] = 'application/json'
  const xsrf = readCookie('XSRF-TOKEN')
  if (xsrf) result['X-XSRF-TOKEN'] = xsrf
  return result
}

/** Leaving the editor: the lock and the avatar go at once. `keepalive` so it survives closing the tab. Never throws. */
export function leavePresence(documentId: string): void {
  try {
    void fetch(`${API_BASE}${doc(documentId)}/presence`, { method: 'DELETE', headers: headers(), credentials: 'include', keepalive: true }).catch(() => undefined)
  } catch {
    // No fetch (tests) or the page is going away: the lease runs out by itself.
  }
}

/** Moves the lock to this user (publishers, or anyone once the lease ran out). */
export async function takeOverLock(documentId: string): Promise<Presence> {
  return readPresence((await api.post<unknown>(`${doc(documentId)}/lock/take-over`)).data)
}

/** Sends the person editing a bell notification "<name> asks to edit <page>". */
export async function requestEdit(documentId: string): Promise<boolean> {
  const data = (await api.post<{ sent?: unknown } | null>(`${doc(documentId)}/lock/request`)).data
  return data?.sent !== false
}

/** A 423 DOCUMENT_LOCKED: who holds the page (null when it isn't that error). */
export function lockedBy(error: unknown): Person | { id: null; name: string } | null {
  if (!(error instanceof ApiError) || error.status !== 423) return null
  return person(error.details?.user) ?? { id: null, name: 'Someone else' }
}

/* ---------------------------------------------------------------- comments --------------------- */

export type CommentAnchor = { x: number; y: number }

export type BuilderComment = {
  id: string
  /** The thread's pin number (stable; top-level comments). */
  number: number | null
  /** The part it was pinned on is no longer on the page. */
  node_removed: boolean
  node_id: string | null
  anchor: CommentAnchor | null
  body: string
  mentions: Person[]
  author: Person | null
  parent_id: string | null
  resolved_at: string | null
  resolved_by: Person | null
  created_at: string | null
  updated_at: string | null
  /** Set once the author changed the text. */
  edited_at: string | null
  /** Top-level threads only: the replies, oldest first. */
  replies: BuilderComment[]
  can_edit: boolean
  can_delete: boolean
}

export type CommentStatus = 'open' | 'resolved' | 'all'

export const COMMENT_MAX = 2000
/** The author may change a comment for this long. */
export const COMMENT_EDIT_MS = 15 * 60_000

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

function readAnchor(value: unknown): CommentAnchor | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as { x?: unknown; y?: unknown }
  const x = Number(v.x)
  const y = Number(v.y)
  return Number.isFinite(x) && Number.isFinite(y) ? { x: clamp01(x), y: clamp01(y) } : null
}

export function readComment(value: unknown): BuilderComment | null {
  if (typeof value !== 'object' || value === null) return null
  const c = value as Record<string, unknown>
  if (c.id === undefined || c.id === null) return null
  const mentions = (Array.isArray(c.mentions) ? c.mentions : []).map((m) => (typeof m === 'object' ? person(m) : null)).filter((m): m is Person => m !== null)
  return {
    id: String(c.id),
    number: typeof c.number === 'number' && Number.isFinite(c.number) ? c.number : null,
    node_removed: c.node_removed === true,
    node_id: typeof c.node_id === 'string' && c.node_id !== '' ? c.node_id : null,
    anchor: readAnchor(c.anchor),
    body: typeof c.body === 'string' ? c.body : '',
    mentions,
    author: person(c.author),
    parent_id: c.parent_id === null || c.parent_id === undefined ? null : String(c.parent_id),
    resolved_at: text(c.resolved_at),
    resolved_by: person(c.resolved_by),
    created_at: text(c.created_at),
    updated_at: text(c.updated_at),
    edited_at: text(c.edited_at),
    replies: (Array.isArray(c.replies) ? c.replies : []).map(readComment).filter((r): r is BuilderComment => r !== null),
    can_edit: c.can_edit === true,
    can_delete: c.can_delete === true,
  }
}

/**
 * The threads (top-level comments with their replies). A flat list (replies as their own rows with
 * `parent_id`) is folded into threads too.
 */
export function readThreads(value: unknown): BuilderComment[] {
  const list = (Array.isArray(value) ? value : []).map(readComment).filter((c): c is BuilderComment => c !== null)
  const tops = list.filter((c) => c.parent_id === null)
  const byId = new Map(tops.map((t) => [t.id, { ...t, replies: [...t.replies] }]))
  for (const reply of list) {
    if (reply.parent_id === null) continue
    const thread = byId.get(reply.parent_id)
    if (thread && !thread.replies.some((r) => r.id === reply.id)) thread.replies.push(reply)
  }
  return [...byId.values()]
}

export async function fetchComments(documentId: string, status: CommentStatus = 'all', signal?: AbortSignal): Promise<BuilderComment[]> {
  return readThreads((await api.get<unknown>(`${doc(documentId)}/comments`, { query: { status }, signal })).data)
}

export type NewComment = { node_id?: string | null; anchor?: CommentAnchor | null; body: string; parent_id?: string | null; mentions?: string[] }

export async function createComment(documentId: string, input: NewComment): Promise<BuilderComment | null> {
  const body: Record<string, unknown> = { body: input.body }
  if (input.node_id) body.node_id = input.node_id
  if (input.anchor) body.anchor = { x: clamp01(input.anchor.x), y: clamp01(input.anchor.y) }
  if (input.parent_id) body.parent_id = input.parent_id
  if (input.mentions && input.mentions.length > 0) body.mentions = input.mentions
  return readComment((await api.post<unknown>(`${doc(documentId)}/comments`, body)).data)
}

export async function editComment(documentId: string, commentId: string, body: string, mentions?: string[]): Promise<BuilderComment | null> {
  const payload: Record<string, unknown> = { body }
  if (mentions && mentions.length > 0) payload.mentions = mentions
  return readComment((await api.patch<unknown>(`${doc(documentId)}/comments/${encodeURIComponent(commentId)}`, payload)).data)
}

export async function resolveComment(documentId: string, commentId: string, resolved: boolean): Promise<void> {
  await api.post<unknown>(`${doc(documentId)}/comments/${encodeURIComponent(commentId)}/${resolved ? 'resolve' : 'reopen'}`)
}

export async function deleteComment(documentId: string, commentId: string): Promise<void> {
  await api.delete(`${doc(documentId)}/comments/${encodeURIComponent(commentId)}`)
}

/** Staff of the store who can view the store builder, for @mentions (at most 20). */
export async function fetchMentionable(query: string, signal?: AbortSignal): Promise<Person[]> {
  const data = (await api.get<unknown>(`${BASE}/mentionable`, { query: { q: query }, signal })).data
  return (Array.isArray(data) ? data : []).map(person).filter((p): p is Person => p !== null)
}

/* ---------------------------------------------------------------- activity --------------------- */

export type ActivityEntry = {
  id: string
  at: string
  user: Person | null
  action: string
  summary: string
  details: Record<string, unknown>
}

export type ActivityPage = { entries: ActivityEntry[]; nextBefore: string | null }

export const ACTIVITY_PAGE = 30

export async function fetchActivity(documentId: string, before: string | null, signal?: AbortSignal): Promise<ActivityPage> {
  const response = await api.get<unknown>(`${doc(documentId)}/activity`, { query: before ? { before, limit: ACTIVITY_PAGE } : { limit: ACTIVITY_PAGE }, signal })
  const entries: ActivityEntry[] = []
  for (const [index, entry] of (Array.isArray(response.data) ? response.data : []).entries()) {
    const e = (entry ?? {}) as Record<string, unknown>
    const at = text(e.at)
    if (!at) continue
    entries.push({
      id: e.id !== undefined && e.id !== null ? String(e.id) : `${at}-${index}`,
      at,
      user: person(e.user),
      action: typeof e.action === 'string' ? e.action : '',
      summary: typeof e.summary === 'string' ? e.summary : '',
      details: typeof e.details === 'object' && e.details !== null ? (e.details as Record<string, unknown>) : {},
    })
  }
  const meta = response.meta as { next_before?: unknown; has_more?: unknown }
  const last = entries[entries.length - 1]
  const nextBefore = typeof meta.next_before === 'string' ? meta.next_before : meta.next_before === null ? null : meta.has_more === false || entries.length < ACTIVITY_PAGE ? null : (last?.at ?? null)
  return { entries, nextBefore }
}

/* ---------------------------------------------------------------- export ----------------------- */

/** A file name for the copy: the page title in lower case with dashes, `.json`. */
export function exportFilename(title: string): string {
  const base = title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return `${base || 'page'}.json`
}

function filenameOf(disposition: string | null): string | null {
  if (!disposition) return null
  const extended = /filename\*\s*=\s*[^']*'[^']*'([^;]+)/i.exec(disposition)
  if (extended?.[1]) {
    try {
      return decodeURIComponent(extended[1].trim().replace(/^"|"$/g, ''))
    } catch {
      // Fall back to the plain name.
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(disposition)
  return plain?.[1]?.trim() || null
}

/**
 * "Download a copy (.json)": the page as a file another store can import. The body is the export
 * itself (JSON); a failure is the usual error envelope (422 EXPORT_TOO_LARGE, 403 …).
 */
export async function downloadExport(documentId: string, title: string): Promise<string> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${doc(documentId)}/export`, { method: 'GET', headers: headers(), credentials: 'include' })
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection.')
  }
  const raw = await response.text()
  let payload: unknown = null
  try {
    payload = JSON.parse(raw)
  } catch {
    payload = null
  }
  const failure = payload as Partial<ApiFailure> | null
  if (!response.ok || (failure && failure.success === false && failure.error)) {
    if (failure?.error) throw new ApiError(response.status, failure.error.code, failure.error.message, failure.error.details ?? {}, failure.meta?.request_id ?? null)
    throw new ApiError(response.status, 'INVALID_RESPONSE', 'The server returned an unexpected response.')
  }
  // An envelope around the file (`{success, data: {format …}}`) is unwrapped.
  const envelope = payload as { success?: unknown; data?: unknown } | null
  const body = envelope && envelope.success === true && envelope.data !== undefined ? JSON.stringify(envelope.data, null, 2) : raw
  const filename = filenameOf(response.headers.get('Content-Disposition')) ?? exportFilename(title)
  saveBlob(new Blob([body], { type: 'application/json' }), filename)
  return filename
}

/* ---------------------------------------------------------------- campaign page address -------- */

/**
 * B16: changes a campaign page's address (`landing:<slug>`, storefront.manage). The server adds an
 * automatic 301 from the old address. 409 DOCUMENT_EXISTS: the address is taken; 423 DOCUMENT_LOCKED.
 */
export async function changeAddress(documentId: string, slug: string): Promise<{ key: string; path: string | null; preview_url: string | null }> {
  const data = (await api.post<{ key?: string; path?: string | null; preview_url?: string | null }>(`${doc(documentId)}/address`, { slug })).data ?? {}
  return { key: data.key ?? `landing:${slug}`, path: data.path ?? `/p/${slug}`, preview_url: data.preview_url ?? null }
}

/** A slug as the store uses it: lower case letters, digits and dashes. */
export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
}
