import { isMarkState, useElementData, usePage, type MarkState } from '../render-context'
import type { BuilderData, BuilderMedia } from '../types'
import { isObject } from './shared'

/*
 * Small helpers of the B8a renderers: the element's data with its draft state, media by id and
 * per-id state maps (`columns` / `items` in draft payloads). The plain image is ./b8a-img.
 */

/** `data[id]` when it has the expected shape, and the draft state that keeps it from visitors. */
export function useB8aData<T extends BuilderData>(id: string, is: (data: BuilderData) => data is T): { data: T | null; state: MarkState | null; draft: boolean } {
  const { draft } = usePage()
  const entry = useElementData(id)
  const data = entry && is(entry) ? entry : null
  const raw = data && 'state' in data ? (data as { state?: unknown }).state : null
  return { data, state: isMarkState(raw) ? raw : null, draft }
}

/** The payload's media by id (with its id, as MediaRef wants), or null. */
export function useMedia(id: unknown): (BuilderMedia & { id: string }) | null {
  const { page } = usePage()
  return typeof id === 'string' && Object.hasOwn(page.media ?? {}, id) ? { id, ...page.media[id]! } : null
}

/** A map of `{<id>: {state}}` from a draft payload (the server may send `[]` for none). */
export function stateMap(value: unknown): Record<string, MarkState> {
  if (!isObject(value)) return {}
  const out: Record<string, MarkState> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (isObject(entry) && isMarkState(entry.state)) out[key] = entry.state
  }
  return out
}
