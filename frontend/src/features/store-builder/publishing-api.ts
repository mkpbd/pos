import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/api/client'
import { storefrontKeys, type ThemeDraft } from '@/features/storefront/api'
import type { BuilderPage, PopupSettings } from '@/storefront/builder/types'
import type { DocumentDetail, DocumentKind } from './api'

/*
 * B11 admin API of publishing later, named versions and draft checkpoints, compare, and approval
 * (B11 contract §1–§3). Every path and payload shape of these features lives in this one file, so
 * a rename on the server is a one-line change here. Paths are under /storefront/builder; every
 * call is organization-scoped. Readers are tolerant: optional fields may be missing.
 */

const BASE = '/storefront/builder'
const doc = (id: string) => `${BASE}/documents/${encodeURIComponent(id)}`
const review = (id: string) => `${BASE}/reviews/${encodeURIComponent(id)}`

export type Person = { id: string; name: string | null }

/* ---------------------------------------------------------------- §1 publish later ------------ */

export type ScheduleStatus = 'pending' | 'done' | 'failed' | 'cancelled'

/** Why a planned publish failed (`DOCUMENT_INVALID` carries the problems). */
export type ScheduleFailure = { code: string; message: string; errors?: { path?: string; node_id?: string | null; message: string; code?: string }[] }

/** A document's planned publish (summaries and detail `schedule`: pending, else the latest failed one; null = none). */
export type DocumentSchedule = {
  id: string
  /** ISO 8601 instant. */
  publish_at: string
  status: ScheduleStatus
  note: string | null
  created_by: Person | null
  failure?: ScheduleFailure | null
  /** Planned by approving a review. */
  review_id?: string | null
  /** The version it made (done). */
  version?: { id: string; number: number } | null
  /** The draft changed since it was planned (the plan still publishes its snapshot). */
  draft_changed?: boolean
  finished_at?: string | null
  created_at?: string | null
}

/** The plain reason of a failed planned publish. */
export function failureText(schedule: Pick<DocumentSchedule, 'failure'>): string | null {
  const failure = schedule.failure
  if (!failure) return null
  const first = failure.errors?.[0]?.message
  return first && first !== failure.message ? `${failure.message} ${first}` : failure.message
}

/** The longest a publish may be planned ahead (the server allows ≤ 1 year). */
export const SCHEDULE_MAX_DAYS = 365

/**
 * POST …/schedule `{publish_at, note?}` (storefront.publish) → the document detail: the draft as it
 * is now goes live then; it replaces a pending schedule.
 */
export function schedulePublish(documentId: string, input: { publish_at: string; note: string | null }) {
  return api.post<DocumentDetail>(`${doc(documentId)}/schedule`, input.note ? input : { publish_at: input.publish_at }).then((r) => r.data)
}

/** DELETE …/schedule → the document detail; 409 NOTHING_SCHEDULED when there was none. */
export function cancelSchedule(documentId: string) {
  return api.delete<DocumentDetail>(`${doc(documentId)}/schedule`).then((r) => r.data)
}

/* ---------------------------------------------------------------- §1 theme -------------------- */

/** The theme draft payload's `schedule` (pending, else the latest failed one; null = none). */
export function themeScheduleOf(draft: unknown): DocumentSchedule | null {
  const schedule = (draft as { schedule?: DocumentSchedule | null } | null | undefined)?.schedule
  return schedule && typeof schedule === 'object' ? schedule : null
}

/**
 * B11 theme publishing: publish now (`cancel_schedule` when a plan is pending), publish later
 * (POST /storefront/theme/schedule) and cancel (DELETE). Every call answers with the theme draft
 * payload, which replaces the cached draft (as usePublishThemeMutation does).
 */
export function useThemePublishing() {
  const queryClient = useQueryClient()
  const take = (data: unknown) => {
    void queryClient.invalidateQueries({ queryKey: storefrontKeys.theme, exact: true })
    if (data && typeof data === 'object' && 'settings' in data && 'draft_revision' in data) queryClient.setQueryData(storefrontKeys.themeDraft, data)
    else void queryClient.invalidateQueries({ queryKey: storefrontKeys.themeDraft })
  }
  const publish = useMutation({
    mutationFn: ({ note, cancelSchedule }: { note: string | null; cancelSchedule?: boolean }) => {
      const body: Record<string, unknown> = note ? { note } : {}
      if (cancelSchedule !== undefined) body.cancel_schedule = cancelSchedule
      return api.post<ThemeDraft>('/storefront/theme/publish', body).then((r) => r.data)
    },
    onSuccess: (data) => {
      take(data)
      void queryClient.invalidateQueries({ queryKey: storefrontKeys.themeVersions })
    },
  })
  const schedule = useMutation({
    mutationFn: (input: { publish_at: string; note: string | null }) => api.post<ThemeDraft>('/storefront/theme/schedule', input.note ? input : { publish_at: input.publish_at }).then((r) => r.data),
    onSuccess: take,
  })
  const cancel = useMutation({
    mutationFn: () => api.delete<ThemeDraft>('/storefront/theme/schedule').then((r) => r.data),
    onSuccess: take,
    onError: (error) => {
      // Already gone (it went live or someone cancelled it): show the draft as it is now.
      if (error instanceof ApiError && error.code === 'NOTHING_SCHEDULED') void queryClient.invalidateQueries({ queryKey: storefrontKeys.themeDraft })
    },
  })
  return { publish, schedule, cancel }
}

/* ---------------------------------------------------------------- §2 versions & compare ------- */

/** A published version or a draft checkpoint ("Save a named copy"). */
export type VersionEntry = {
  id: string
  kind: 'version' | 'checkpoint'
  /** Versions only; null for checkpoints. */
  number: number | null
  name: string | null
  note: string | null
  /** Versions only; null for checkpoints. */
  published_at: string | null
  created_by: Person | null
  created_at: string | null
  /** How a version went live: published by hand, by a planned publish or by approving a review. */
  via?: 'manual' | 'scheduled' | 'review' | null
}

/** Longest version / checkpoint name. */
export const VERSION_NAME_MAX = 80
/** Checkpoints kept per document (the oldest unnamed go first; all named → 422 CHECKPOINT_LIMIT). */
export const CHECKPOINT_LIMIT = 20

export const publishingKeys = {
  versions: (id: string) => ['store-builder', 'documents', id, 'versions', 'with-checkpoints'] as const,
  render: (id: string, versionId: string) => ['store-builder', 'documents', id, 'versions', versionId, 'render'] as const,
  compare: (id: string, from: string, to: string) => ['store-builder', 'documents', id, 'compare', from, to] as const,
  reviews: (status: ReviewStatus) => ['store-builder', 'reviews', status] as const,
  review: (id: string) => ['store-builder', 'reviews', 'one', id] as const,
}

/** GET …/versions?include=checkpoints, newest first. Old servers without `kind` give versions only. */
export async function fetchVersions(documentId: string, signal?: AbortSignal): Promise<VersionEntry[]> {
  const list = (await api.get<Partial<VersionEntry>[]>(`${doc(documentId)}/versions`, { signal, query: { include: 'checkpoints' } })).data ?? []
  return list.map((v) => ({
    id: String(v.id),
    kind: v.kind === 'checkpoint' ? 'checkpoint' : 'version',
    number: typeof v.number === 'number' ? v.number : null,
    name: v.name ?? null,
    note: v.note ?? null,
    published_at: v.published_at ?? null,
    created_by: v.created_by ?? null,
    created_at: v.created_at ?? null,
    via: v.via ?? null,
  }))
}

export function useVersionEntries(documentId: string, enabled: boolean) {
  return useQuery({ queryKey: publishingKeys.versions(documentId), queryFn: ({ signal }) => fetchVersions(documentId, signal), enabled, staleTime: 0 })
}

/** PATCH …/versions/{version} `{name}` — `null` clears it. */
export function renameVersion(documentId: string, versionId: string, name: string | null) {
  return api.patch<VersionEntry>(`${doc(documentId)}/versions/${encodeURIComponent(versionId)}`, { name }).then((r) => r.data)
}

/** POST …/checkpoints `{name}`: the saved draft kept under a name (not published). */
export function saveCheckpoint(documentId: string, name: string) {
  return api.post<VersionEntry>(`${doc(documentId)}/checkpoints`, { name }).then((r) => r.data)
}

/** DELETE …/versions/{checkpoint}: checkpoints only (409 VERSION_NOT_DELETABLE for versions). */
export function deleteCheckpoint(documentId: string, checkpointId: string) {
  return api.delete(`${doc(documentId)}/versions/${encodeURIComponent(checkpointId)}`)
}

/** What a read-only canvas draws: the render payload of a version, checkpoint, review snapshot or the draft. */
export type RenderPayload = Pick<BuilderPage, 'sections' | 'media' | 'data'> & {
  /** Popups: the settings of that version (the canvas draws its layout). */
  popup?: PopupSettings | null
}

function readRender(body: unknown): RenderPayload {
  const value = (body ?? {}) as Partial<RenderPayload> & { render?: RenderPayload }
  const payload = value.render ?? value
  return { sections: payload.sections ?? [], media: payload.media ?? {}, data: payload.data ?? {}, popup: payload.popup ?? null }
}

/** GET …/versions/{version}/render: a version or checkpoint as the canvas draws it. */
export async function fetchVersionRender(documentId: string, versionId: string, signal?: AbortSignal): Promise<RenderPayload> {
  return readRender((await api.get<unknown>(`${doc(documentId)}/versions/${encodeURIComponent(versionId)}/render`, { signal, query: { lang: 'en' } })).data)
}

/** GET …/render?source=published: the live version as the canvas draws it; null when nothing is published (409 NOTHING_PUBLISHED). */
export async function fetchLiveRender(documentId: string, signal?: AbortSignal): Promise<RenderPayload | null> {
  try {
    return readRender((await api.get<unknown>(`${doc(documentId)}/render`, { signal, query: { source: 'published', lang: 'en' } })).data)
  } catch (error) {
    if (error instanceof ApiError && error.code === 'NOTHING_PUBLISHED') return null
    throw error
  }
}

/** One side of a compare: a version / checkpoint id, the draft or the live version. */
export type CompareSide = string

/** A node of the change list; `node_id` null = the page itself (search & sharing, popup settings: type `document`). */
export type CompareNode = { node_id: string; type: string; label?: string | null }
export type FieldChange = { field: string; before: unknown; after: unknown }
export type CompareResult = {
  added: CompareNode[]
  removed: CompareNode[]
  changed: (Omit<CompareNode, 'node_id'> & { node_id: string | null; fields: FieldChange[] })[]
  moved: (string | CompareNode)[]
  /** B12: containers (`root` = the sections, else a column id) whose phone / tablet order differs. */
  device_moved: { id: string; device: 'tablet' | 'mobile' }[]
}

type RawNode = { id?: string; node_id?: string | null; type?: string; label?: string | null }

/** The server's `{id, type, kind, parent_id, label}` (added / removed) and `{node_id, …}` (changed) as CompareNode. */
export function readCompare(body: unknown): CompareResult {
  const value = (body ?? {}) as { added?: RawNode[]; removed?: RawNode[]; changed?: (RawNode & { fields?: FieldChange[] })[]; moved?: (string | RawNode)[]; device_moved?: unknown }
  const node = (n: RawNode): CompareNode => ({ node_id: String(n.node_id ?? n.id ?? ''), type: n.type ?? 'element', label: n.label ?? null })
  return {
    added: (value.added ?? []).map(node),
    removed: (value.removed ?? []).map(node),
    changed: (value.changed ?? []).map((n) => ({ node_id: n.node_id ?? n.id ?? null, type: n.type ?? 'element', label: n.label ?? null, fields: n.fields ?? [] })),
    moved: (value.moved ?? []).map((n) => (typeof n === 'string' ? n : node(n))),
    device_moved: (Array.isArray(value.device_moved) ? value.device_moved : []).flatMap((entry: unknown) => {
      const { id, device } = (entry ?? {}) as { id?: unknown; device?: unknown }
      return typeof id === 'string' && (device === 'tablet' || device === 'mobile') ? [{ id, device }] : []
    }),
  }
}

/** GET …/compare?from=&to= (`<id>`, `draft` or `live`): what changed from `from` to `to`. */
export async function fetchCompare(documentId: string, from: CompareSide, to: CompareSide, signal?: AbortSignal): Promise<CompareResult> {
  return readCompare((await api.get<unknown>(`${doc(documentId)}/compare`, { signal, query: { from, to } })).data)
}

/* ---------------------------------------------------------------- §3 approval ----------------- */

export type ReviewStatus = 'pending' | 'approved' | 'sent_back' | 'withdrawn'

/** The document a review is for. */
export type ReviewDocument = { id: string; kind: DocumentKind; key: string; title: string; path?: string | null; schedule?: DocumentSchedule | null }

/** A review (summaries and detail `review`: the latest pending or sent back since the last publish; null = none). */
export type DocumentReview = {
  id: string
  status: ReviewStatus
  /** The submitter's message. */
  note: string | null
  /** The approver's comment (required when sent back). */
  comment: string | null
  submitted_by: Person | null
  submitted_at: string | null
  decided_by?: Person | null
  decided_at?: string | null
  /** The draft was edited after it was submitted (the approver still publishes what was submitted). */
  draft_changed?: boolean
  /** Approved for later: the planned publish. */
  schedule?: DocumentSchedule | null
  version?: { id: string; number: number } | null
  document?: ReviewDocument
}

/** A review in the inbox, with the document it is for. */
export type ReviewSummary = DocumentReview & { document: ReviewDocument }

/** GET /reviews/{id}: the submitted snapshot as the canvas draws it and what changed from the live version. */
export type ReviewDetail = ReviewSummary & { render: RenderPayload; changes: CompareResult }

export async function fetchReviews(status: ReviewStatus, signal?: AbortSignal): Promise<ReviewSummary[]> {
  return (await api.get<ReviewSummary[]>(`${BASE}/reviews`, { signal, query: { status } })).data ?? []
}

export function useReviewsQuery(status: ReviewStatus, enabled: boolean) {
  return useQuery({ queryKey: publishingKeys.reviews(status), queryFn: ({ signal }) => fetchReviews(status, signal), enabled, staleTime: 30_000 })
}

/** GET /reviews/{id} → `{review, document, render, changes}` (a flat review is read too). */
export async function fetchReview(reviewId: string, signal?: AbortSignal): Promise<ReviewDetail> {
  const body = (await api.get<{ review?: DocumentReview; document?: ReviewDocument; render?: unknown; changes?: unknown } & Partial<DocumentReview>>(review(reviewId), { signal, query: { lang: 'en' } })).data
  const base = (body.review ?? body) as DocumentReview
  const document = (body.document ?? base.document) as ReviewDocument
  return { ...base, document, render: readRender(body.render), changes: readCompare(body.changes) }
}

/** POST …/reviews `{note?}` (manage, without publish): the draft as it is now is sent for approval (a pending one is withdrawn). */
export function submitForReview(documentId: string, note: string | null) {
  return api.post<DocumentReview>(`${doc(documentId)}/reviews`, note ? { note } : {}).then((r) => r.data)
}

/**
 * POST /reviews/{id}/approve `{publish_at?, note?, cancel_schedule?}` (publish) → `{review, document}`:
 * publishes the submitted snapshot now, or plans it.
 */
export function approveReview(reviewId: string, input: { publish_at: string | null; note: string | null; cancel_schedule?: boolean }) {
  const body: Record<string, string | boolean> = {}
  if (input.publish_at) body.publish_at = input.publish_at
  if (input.note) body.note = input.note
  if (input.cancel_schedule !== undefined) body.cancel_schedule = input.cancel_schedule
  return api.post<{ review: DocumentReview; document: DocumentDetail }>(`${review(reviewId)}/approve`, body).then((r) => r.data)
}

/** POST /reviews/{id}/send-back `{comment}` (publish): back to the submitter with what to change. */
export function sendBackReview(reviewId: string, comment: string) {
  return api.post<DocumentReview>(`${review(reviewId)}/send-back`, { comment }).then((r) => r.data)
}

/** POST /reviews/{id}/withdraw (the submitter, or a publisher). */
export function withdrawReview(reviewId: string) {
  return api.post<DocumentReview>(`${review(reviewId)}/withdraw`).then((r) => r.data)
}

/** The longest review note. */
export const REVIEW_NOTE_MAX = 500
/** The longest send-back comment. */
export const REVIEW_COMMENT_MAX = 1000
