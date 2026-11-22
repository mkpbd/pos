import { useId, useState } from 'react'
import { LayoutDashboardIcon, ShuffleIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Section } from '@/storefront/builder/types'
import { nodeName, useCommands, useEditorUi } from '../commands'
import { noteBlocked } from '../collab/use-presence'
import { useEditor, useEditorStoreApi } from '../store'
import { findNode } from '../tree'
import { applyLayoutToContent, layoutVariants, nextVariant, type LayoutPreview, type LayoutVariant } from './layout-variants'

/*
 * B21 "Try another layout" (the section's mini toolbar and the inspector header): a strip of mini
 * previews under the canvas — click one to rearrange the section (one undo step), "Shuffle" steps
 * through them. Only the arrangement changes; every text, picture, button and product stays.
 */

const box = 'rounded-[2px] bg-neutral-400'
const lines = (
  <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
    <span className="h-1 w-4/5 rounded-full bg-neutral-700" />
    <span className="h-0.5 w-full rounded-full bg-neutral-400" />
    <span className="h-0.5 w-3/5 rounded-full bg-neutral-400" />
    <span className="mt-0.5 h-1.5 w-1/3 rounded-sm bg-blue-500" />
  </span>
)

/** A small CSS drawing of an arrangement (decorative; the button carries the name). */
export function MiniPreview({ preview }: { preview: LayoutPreview }) {
  const frame = 'flex h-14 w-24 shrink-0 gap-1 overflow-hidden rounded border bg-white p-1.5'
  switch (preview.kind) {
    case 'media':
      if (preview.media === 'behind') {
        return (
          <span aria-hidden className={cn(frame, 'relative items-center bg-neutral-500 px-3')}>
            <span className="flex w-full flex-col items-center gap-0.5">
              <span className="h-1 w-4/5 rounded-full bg-white" />
              <span className="h-0.5 w-full rounded-full bg-white/70" />
              <span className="mt-0.5 h-1.5 w-1/3 rounded-sm bg-blue-400" />
            </span>
          </span>
        )
      }
      return (
        <span aria-hidden className={cn(frame, preview.media === 'top' ? 'flex-col' : preview.media === 'right' ? 'flex-row-reverse' : 'flex-row')}>
          <span className={cn(box, preview.media === 'top' ? 'h-5 w-full' : 'h-full w-2/5')} />
          {lines}
        </span>
      )
    case 'cards':
      return (
        <span aria-hidden className={cn(frame, 'grid content-start gap-0.5')} style={{ gridTemplateColumns: `repeat(${preview.perRow}, minmax(0, 1fr))` }}>
          {Array.from({ length: Math.min(preview.count, preview.perRow * 2) }, (_, i) => (
            <span key={i} className={cn(box, 'h-4')} />
          ))}
        </span>
      )
    case 'list':
      return (
        <span aria-hidden className={cn(frame, 'flex-col')}>
          {Array.from({ length: Math.min(preview.count, 3) }, (_, i) => (
            <span key={i} className="flex items-center gap-1">
              <span className={cn(box, 'size-2.5')} />
              <span className="h-1 flex-1 rounded-full bg-neutral-400" />
            </span>
          ))}
        </span>
      )
    case 'carousel':
      return (
        <span aria-hidden className={cn(frame, 'items-center')}>
          <span className="text-[10px] text-neutral-500">‹</span>
          {[0, 1, 2].map((i) => (
            <span key={i} className={cn(box, 'h-8 flex-1')} />
          ))}
          <span className="text-[10px] text-neutral-500">›</span>
        </span>
      )
    case 'align':
      return (
        <span aria-hidden className={cn(frame, 'flex-col justify-center gap-0.5', preview.align === 'center' ? 'items-center' : 'items-start')}>
          <span className="h-1 w-3/5 rounded-full bg-neutral-700" />
          <span className="h-0.5 w-4/5 rounded-full bg-neutral-400" />
          <span className="h-0.5 w-1/2 rounded-full bg-neutral-400" />
          <span className="mt-0.5 h-1.5 w-1/4 rounded-sm bg-blue-500" />
        </span>
      )
  }
}

export function LayoutVariantsPanel({ sectionId, onClose }: { sectionId: string | null; onClose: () => void }) {
  if (!sectionId) return null
  return <Panel key={sectionId} sectionId={sectionId} onClose={onClose} />
}

function Panel({ sectionId, onClose }: { sectionId: string; onClose: () => void }) {
  const store = useEditorStoreApi()
  const commands = useCommands()
  const content = useEditor((s) => s.content)
  const readOnly = useEditor((s) => s.readOnly)
  const { registry, globals, canvas } = useEditorUi()
  const titleId = useId()
  const [last, setLast] = useState<string | null>(null)
  const [said, setSaid] = useState('')
  const info = findNode(content, sectionId)
  const section = info?.kind === 'section' && info.node.type === 'section' ? (info.node as Section) : null
  const variants = section ? layoutVariants(section) : []
  const name = info ? nodeName(info.node, registry, globals) : ''

  const apply = (variant: LayoutVariant) => {
    if (readOnly) return void noteBlocked(store)
    if (store.getState().apply((c) => applyLayoutToContent(c, sectionId, variant.id), { select: sectionId })) {
      setLast(variant.id)
      setSaid(`${variant.label}. Undo puts the old layout back.`)
      commands.reveal(sectionId)
      canvas.current?.scrollTo(sectionId)
    }
  }

  return (
    <section aria-labelledby={titleId} data-testid="layout-variants" className="flex shrink-0 flex-col border-t bg-background">
      <div className="flex items-center gap-2 border-b px-3 py-1.5">
        <LayoutDashboardIcon className="size-4 text-muted-foreground" aria-hidden />
        <h2 id={titleId} className="min-w-0 truncate text-sm font-semibold">
          Try another layout{name ? <span className="font-normal text-muted-foreground"> · {name}</span> : null}
        </h2>
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={variants.length < 2 || readOnly}
            onClick={() => {
              const next = nextVariant(variants, last)
              if (next) apply(next)
            }}
            data-testid="layout-shuffle"
          >
            <ShuffleIcon data-icon="inline-start" /> Shuffle
          </Button>
          <Button type="button" variant="ghost" size="icon" className="size-8" aria-label="Close Try another layout" onClick={onClose}>
            <XIcon />
          </Button>
        </div>
      </div>
      {variants.length < 2 ? (
        <p className="px-3 py-3 text-sm text-muted-foreground" data-testid="layout-none">
          {section ? 'This section has no other layouts to try. Sections with a picture and text, rows of cards, products, galleries and reviews do.' : 'Select a section to try other layouts for it.'}
        </p>
      ) : (
        <>
          <p className="px-3 pt-1.5 text-xs text-muted-foreground">Only the arrangement changes — every text, picture, button and product stays. Each change is one undo step.</p>
          <ul className="flex gap-2 overflow-x-auto px-3 py-2" aria-label="Layouts">
            {variants.map((variant) => (
              <li key={variant.id}>
                <button
                  type="button"
                  aria-pressed={variant.current}
                  disabled={readOnly}
                  onClick={() => apply(variant)}
                  data-testid={`layout-${variant.id}`}
                  className={cn(
                    'flex w-28 flex-col items-center gap-1 rounded-md border p-1.5 text-center text-xs hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60',
                    variant.current && 'border-primary bg-primary/5 font-medium',
                  )}
                >
                  <MiniPreview preview={variant.preview} />
                  <span>{variant.label}</span>
                  {variant.current && <span className="sr-only">(now)</span>}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <p role="status" className="sr-only">
        {said}
      </p>
    </section>
  )
}
