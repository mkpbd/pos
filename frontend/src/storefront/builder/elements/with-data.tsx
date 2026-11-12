import type { ReactNode } from 'react'
import { isMarkState, useElementData, usePage } from '../render-context'
import { DraftPlaceholder, PreviewMark } from '../preview-mark'
import type { BuilderData, RenderElement } from '../types'

/**
 * An element drawn from its resolved data (`data[id]`): countdown, discount, promo card, menu, FAQ
 * list. Without usable data visitors see nothing and a draft keeps a marked placeholder; data
 * with a `state` (draft only: an ended or inactive promotion, an unavailable product) is drawn
 * marked in a draft and never for visitors.
 */
export function WithData<T extends BuilderData>({
  element,
  is,
  children,
  fallback,
  shownWhen,
}: {
  element: RenderElement
  is: (data: BuilderData) => data is T
  children: (data: T) => ReactNode
  /** Data to draw while the payload has none (e.g. a countdown to a fixed date in the editor canvas). */
  fallback?: T | null
  /** A state visitors still see (an ended countdown that shows its "after" text). */
  shownWhen?: (state: string) => boolean
}) {
  const { draft } = usePage()
  const entry = useElementData(element.id)
  const data = entry && is(entry) ? entry : (fallback ?? undefined)
  if (!data) return <DraftPlaceholder element={element} />
  const raw = 'state' in data && isMarkState(data.state) ? data.state : null
  const state = raw && shownWhen?.(raw) ? null : raw
  if (state && !draft) return null
  return <PreviewMark state={state}>{children(data)}</PreviewMark>
}
