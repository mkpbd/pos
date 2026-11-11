import { ApiError } from '@/lib/api/client'
import type { BuilderContent } from '@/storefront/builder/types'
import type { DocumentDetail, Problem } from './api'
import { isDirty, type EditorStore } from './store'

/*
 * Autosave of the draft (B2): 1.5 s after the last change, and on demand (`flush`: blur, preview,
 * publish, leaving the page). One save at a time, always with the revision the server gave last.
 *  - 409 DRAFT_CONFLICT → status `conflict`; nothing is saved until the user chooses
 *    (`resolveConflict('theirs' | 'mine')`).
 *  - 422 → the problems per node (`details.errors[].node_id`) go to `errors`, status `invalid`;
 *    the same content is not sent again — the next change retries.
 *  - Network errors and 5xx → status `offline`, retried with exponential back-off (2 s … 30 s).
 *  - Any other error → status `error` with its message, retried on the next change.
 */

export type AutosaveOptions = {
  save: (id: string, revision: number, content: BuilderContent) => Promise<DocumentDetail>
  fetchDocument: (id: string) => Promise<DocumentDetail>
  delay?: number
}

export const AUTOSAVE_DELAY = 1500
const RETRY_BASE = 2000
const RETRY_MAX = 30_000

type ErrorEntry = { path?: string; node_id?: string | null; message?: string; code?: string }

/** `details.errors[]` of a 422 DOCUMENT_INVALID, grouped by node id (`''` = the page). */
export function problemsByNode(error: ApiError): Record<string, Problem[]> {
  const list = Array.isArray(error.details?.errors) ? (error.details.errors as ErrorEntry[]) : []
  const result: Record<string, Problem[]> = {}
  for (const entry of list) {
    const key = typeof entry.node_id === 'string' ? entry.node_id : ''
    const problem: Problem = { path: entry.path ?? '', message: entry.message ?? 'This value is not valid.' }
    if (entry.code) problem.code = entry.code
    ;(result[key] ??= []).push(problem)
  }
  if (list.length === 0) result[''] = [{ path: '', message: error.message }]
  return result
}

export function problemCount(errors: Record<string, Problem[]>): number {
  return Object.values(errors).reduce((sum, list) => sum + list.length, 0)
}

export class Autosave {
  private timer: ReturnType<typeof setTimeout> | null = null
  private inFlight: Promise<boolean> | null = null
  private failures = 0
  /** Content the server refused (422) or another error stopped: not re-sent until it changes. */
  private stuck: BuilderContent | null = null
  private conflict = false
  private unsubscribe: (() => void) | null = null
  private readonly delay: number
  private readonly store: EditorStore
  private readonly options: AutosaveOptions

  constructor(store: EditorStore, options: AutosaveOptions) {
    this.store = store
    this.options = options
    this.delay = options.delay ?? AUTOSAVE_DELAY
  }

  start(): void {
    this.unsubscribe = this.store.subscribe((state, previous) => {
      if (state.content === previous.content) return
      if (!isDirty(state)) {
        // Undone back to what the server has.
        this.clearTimer()
        if (!this.inFlight && !this.conflict && ['dirty', 'invalid', 'error'].includes(state.saveState.status)) state.setSaveState({ status: 'saved', savedAt: state.saveState.savedAt })
        return
      }
      if (state.saveState.status === 'saved' || state.saveState.status === 'invalid' || state.saveState.status === 'error') {
        state.setSaveState({ ...state.saveState, status: state.saveState.status === 'saved' ? 'dirty' : state.saveState.status })
      }
      this.schedule()
    })
  }

  stop(): void {
    this.clearTimer()
    this.unsubscribe?.()
    this.unsubscribe = null
  }

  /** Whether leaving now would lose changes. */
  get pending(): boolean {
    return isDirty(this.store.getState()) || this.inFlight !== null
  }

  get inConflict(): boolean {
    return this.conflict
  }

  /** Saves now if needed; true when the server has the current content. */
  async flush(): Promise<boolean> {
    this.clearTimer()
    if (this.inFlight) await this.inFlight
    const state = this.store.getState()
    if (!isDirty(state)) return true
    if (this.conflict || state.content === this.stuck) return false
    return this.run()
  }

  /** After a 409: take the server's draft (mine is lost) or keep mine (save it over theirs). */
  async resolveConflict(choice: 'theirs' | 'mine'): Promise<void> {
    const state = this.store.getState()
    const latest = await this.options.fetchDocument(state.document.id)
    this.conflict = false
    this.stuck = null
    if (choice === 'theirs') {
      this.store.getState().load(latest)
      return
    }
    this.store.getState().setRevision(latest.draft_revision)
    await this.run()
  }

  /** A change was made by something other than an edit (discard, restore): forget earlier failures. */
  reset(): void {
    this.clearTimer()
    this.conflict = false
    this.stuck = null
    this.failures = 0
  }

  private schedule(delay = this.delay): void {
    if (this.conflict) return
    this.clearTimer()
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, delay)
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }

  private run(): Promise<boolean> {
    const promise = this.save().finally(() => {
      this.inFlight = null
    })
    this.inFlight = promise
    return promise
  }

  private async save(): Promise<boolean> {
    const state = this.store.getState()
    const content = state.content
    state.setSaveState({ status: 'saving', savedAt: state.saveState.savedAt })
    try {
      const detail = await this.options.save(state.document.id, state.revision, content)
      this.failures = 0
      this.stuck = null
      this.store.getState().saved(content, detail.draft_revision)
      if (this.store.getState().content !== content) this.schedule()
      return true
    } catch (error) {
      const current = this.store.getState()
      const savedAt = current.saveState.savedAt
      if (error instanceof ApiError && error.status === 409) {
        this.conflict = true
        current.setSaveState({ status: 'conflict', savedAt })
        return false
      }
      if (error instanceof ApiError && error.status === 422) {
        this.stuck = content
        current.setErrors(problemsByNode(error))
        current.setSaveState({ status: current.content === content ? 'invalid' : 'dirty', savedAt })
        if (current.content !== content) this.schedule()
        return false
      }
      if (!(error instanceof ApiError) || error.status === 0 || error.status >= 500) {
        this.failures += 1
        current.setSaveState({ status: 'offline', savedAt })
        this.schedule(Math.min(RETRY_MAX, RETRY_BASE * 2 ** (this.failures - 1)))
        return false
      }
      this.stuck = content
      current.setSaveState({ status: 'error', savedAt, message: error.message })
      return false
    }
  }
}
