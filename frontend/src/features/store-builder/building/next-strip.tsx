import { useState } from 'react'
import { LayoutTemplateIcon, Loader2Icon, PlusIcon, WandSparklesIcon } from 'lucide-react'
import type { Rect } from '@/storefront/builder/canvas/protocol'
import { cn } from '@/lib/utils'
import type { NextSuggestion } from './next-sections'

/*
 * B21 "What next?" on the canvas (editor overlay only — never in previews or on the store): under
 * the last section, three suggested sections as chips plus "More…" (the Templates tab). One click
 * inserts the section's template at the end of the page (one undo step). On an empty page the same
 * suggestions start the page, next to "Build it for me".
 */

export type NextStripPlace = { rect: Rect | null; scale: number; width: number; height: number }

const STRIP_HEIGHT = 44

type Props = {
  place: NextStripPlace
  suggestions: readonly NextSuggestion[]
  pendingId: string | null
  onInsert: (suggestion: NextSuggestion) => void
  onMore: () => void
  /** The empty page's "Build it for me" (absent: not offered). */
  onBuild?: (() => void) | null
}

function Chip({ suggestion, pending, disabled, onInsert }: { suggestion: NextSuggestion; pending: boolean; disabled: boolean; onInsert: () => void }) {
  return (
    <button
      type="button"
      title={suggestion.hint}
      disabled={disabled}
      aria-busy={pending || undefined}
      onClick={onInsert}
      data-testid={`next-${suggestion.role}`}
      className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-white px-2.5 py-1 text-xs font-medium whitespace-nowrap text-blue-800 hover:bg-blue-50 focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:outline-none disabled:opacity-60"
    >
      {pending ? <Loader2Icon className="size-3 animate-spin motion-reduce:animate-none" aria-hidden /> : <PlusIcon className="size-3" aria-hidden />}
      <span className="sr-only">Add </span>
      {suggestion.label}
    </button>
  )
}

export function NextStrip({ place, suggestions, pendingId, onInsert, onMore, onBuild }: Props) {
  const [busy, setBusy] = useState<string | null>(null)
  const pending = pendingId !== null
  const insert = (suggestion: NextSuggestion) => {
    setBusy(suggestion.templateId)
    onInsert(suggestion)
  }
  const chips = suggestions.map((s) => <Chip key={s.templateId} suggestion={s} pending={pending && busy === s.templateId} disabled={pending} onInsert={() => insert(s)} />)
  const more = (
    <button type="button" onClick={onMore} className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-blue-800 underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:outline-none">
      <LayoutTemplateIcon className="size-3" aria-hidden /> More…
    </button>
  )

  if (place.rect === null) {
    if (!onBuild && suggestions.length === 0) return null
    // Below the canvas's own "This page is empty" text (60 % of the screen).
    const top = Math.round(place.height * 0.6) + 12
    return (
      <section
        aria-label="Start your page"
        data-testid="next-empty"
        className="pointer-events-auto absolute left-1/2 flex w-[min(30rem,calc(100%-2rem))] -translate-x-1/2 flex-col gap-3 rounded-lg border bg-white p-4 text-neutral-900 shadow-lg"
        style={{ top }}
      >
        <div>
          <h2 className="text-sm font-semibold">Start your page</h2>
          <p className="text-xs text-neutral-600">Answer four short questions and get a finished page — or add a first section yourself. Nothing is live until you publish.</p>
        </div>
        {onBuild && (
          <button
            type="button"
            onClick={onBuild}
            data-testid="next-build"
            className="inline-flex items-center justify-center gap-2 self-start rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            <WandSparklesIcon className="size-4" aria-hidden /> Build it for me
          </button>
        )}
        {suggestions.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Suggested first sections">
            {chips}
            {more}
          </div>
        )}
      </section>
    )
  }

  if (suggestions.length === 0) return null
  const bottom = (place.rect.y + place.rect.h) * place.scale
  const max = place.height - STRIP_HEIGHT - 8
  // Only while the end of the last section is on screen; near the bottom edge it rides up over it.
  if (bottom > place.height + 4 || bottom < 0) return null
  return (
    <section
      aria-label="What next? Suggested sections"
      data-testid="next-strip"
      className={cn('pointer-events-auto absolute left-1/2 flex max-w-[calc(100%-1rem)] -translate-x-1/2 flex-wrap items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50/95 px-2 py-1.5 shadow')}
      style={{ top: Math.max(4, Math.min(bottom + 8, max)) }}
    >
      <span className="px-1 text-xs font-semibold text-blue-900">What next?</span>
      {chips}
      {more}
    </section>
  )
}
