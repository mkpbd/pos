import type { ReactNode } from 'react'
import { useLocale } from '../i18n/locale'
import { MARK_LABELS, usePage, type MarkState } from './render-context'
import type { RenderElement } from './types'

/** A draft-preview frame around a node visitors would not see. */
export function PreviewMark({ state, children }: { state: MarkState | null; children: ReactNode }) {
  const { t } = useLocale()
  if (!state) return <>{children}</>
  return (
    <div data-node-state={state} className="relative opacity-60 outline-2 outline-offset-[-2px] outline-dashed outline-sf-sale">
      <p className="absolute top-2 left-2 z-10 rounded bg-neutral-900 px-2 py-1 text-xs font-semibold text-white">{t(MARK_LABELS[state])}</p>
      {children}
    </div>
  )
}

/**
 * An element with nothing to draw: visitors see nothing; a draft preview keeps its place, marked
 * (or the canvas's own placeholder, e.g. a skeleton while its data loads).
 */
export function DraftPlaceholder({ element, state = 'empty', hint }: { element: RenderElement; state?: MarkState; hint?: string }) {
  const { draft, placeholder } = usePage()
  if (!draft) return null
  const custom = placeholder ? placeholder(element) : null
  if (custom) return <>{custom}</>
  return (
    <PreviewMark state={state}>
      <div data-b={element.id} className="flex min-h-24 items-end p-3 text-xs text-sf-text">
        {hint}
      </div>
    </PreviewMark>
  )
}
