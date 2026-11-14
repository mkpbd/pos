import { useEffect, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { Rect } from '@/storefront/builder/canvas/protocol'
import { draggedSpacing, SPACING_MAX, SPACING_SNAP, snapSpacing, type SpacingBox, type SpacingSide } from './spacing-drag'

/*
 * B10 spacing handles on the canvas overlay: a small grip on the top and bottom edge of the
 * selected section, inner row or column. Drag to change the padding on that side (hold Alt for
 * the margin) for the device being edited; the value snaps to 4 px and shows in a badge; one drag
 * is one undo step. With the keyboard: focus a grip, ↑ / ↓ change it by 4 px (Alt: margin).
 */

export type SpacingPhase = 'move' | 'end'

export type SpacingValues = Record<SpacingBox, Record<SpacingSide, number | null>>

type Active = { side: SpacingSide; box: SpacingBox; startY: number; startPx: number; px: number }

const SIDE_LABEL: Record<SpacingSide, string> = { top: 'top', bottom: 'bottom' }
const BOX_LABEL: Record<SpacingBox, string> = { padding: 'Padding', margin: 'Margin' }

export function SpacingHandles({ nodeId, nodeLabel, rect, scale, values, deviceLabel, onChange }: {
  nodeId: string
  /** "section", "column", … */
  nodeLabel: string
  rect: Rect
  scale: number
  values: SpacingValues
  deviceLabel: string
  onChange: (box: SpacingBox, side: SpacingSide, px: number, phase: SpacingPhase) => void
}) {
  const [active, setActive] = useState<Active | null>(null)
  // The drag is for one node: a new selection ends it.
  const [owner, setOwner] = useState(nodeId)
  if (owner !== nodeId) {
    setOwner(nodeId)
    setActive(null)
  }

  useEffect(() => {
    if (!active) return
    const at = (clientY: number) => draggedSpacing(active.startPx, (clientY - active.startY) / scale, active.box, active.side)
    const onMove = (event: globalThis.PointerEvent) => {
      const px = at(event.clientY)
      setActive((a) => (a && a.px !== px ? { ...a, px } : a))
      onChange(active.box, active.side, px, 'move')
    }
    const onUp = (event: globalThis.PointerEvent) => {
      onChange(active.box, active.side, at(event.clientY), 'end')
      setActive(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    // Only a new drag re-subscribes; `px` changes while dragging.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.side, active?.box, active?.startY, scale, onChange])

  if (rect.h <= 0) return null
  const left = rect.x * scale
  const top = rect.y * scale
  const width = rect.w * scale
  const height = rect.h * scale

  const grip = (side: SpacingSide) => {
    const padding = values.padding[side]
    const dragging = active?.side === side ? active : null
    const shownBox = dragging?.box ?? 'padding'
    const shown = dragging ? dragging.px : padding
    const y = side === 'top' ? top : top + height

    const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      const box: SpacingBox = event.altKey ? 'margin' : 'padding'
      const start = values[box][side]
      if (start === null) return
      event.preventDefault()
      event.stopPropagation()
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // Not supported (tests): the window listeners still follow the pointer over the cover.
      }
      setActive({ side, box, startY: event.clientY, startPx: start, px: start })
    }
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
      event.preventDefault()
      event.stopPropagation()
      const box: SpacingBox = event.altKey ? 'margin' : 'padding'
      const current = values[box][side]
      if (current === null) return
      onChange(box, side, snapSpacing(current + (event.key === 'ArrowUp' ? SPACING_SNAP : -SPACING_SNAP)), 'end')
    }
    const fixed = padding === null
    return (
      <div
        key={side}
        role="slider"
        tabIndex={0}
        aria-orientation="vertical"
        aria-label={`Padding ${SIDE_LABEL[side]} of the ${nodeLabel} on ${deviceLabel}`}
        aria-valuemin={0}
        aria-valuemax={SPACING_MAX}
        aria-valuenow={padding ?? undefined}
        aria-valuetext={padding === null ? 'Set in % — change it in the Style tab' : `${padding} px`}
        aria-disabled={fixed || undefined}
        title={fixed ? 'This space is set in % — change it in the Style tab.' : `Drag to change the space ${side === 'top' ? 'above' : 'below'} the content (hold Alt for the space outside). ↑ ↓ with the keyboard.`}
        data-testid={`spacing-handle-${side}`}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        className="group pointer-events-auto absolute z-20 flex h-3 w-10 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize touch-none items-center justify-center outline-none aria-disabled:cursor-not-allowed"
        style={{ left: left + width / 2, top: y }}
      >
        <span className={`h-1.5 w-8 rounded-full border border-white shadow ${dragging ? 'bg-pink-600' : 'bg-pink-600/70 group-hover:bg-pink-600 group-focus-visible:bg-pink-600 group-focus-visible:ring-2 group-focus-visible:ring-pink-600'}`} aria-hidden />
        {dragging && shown !== null && (
          <span data-testid="spacing-badge" role="status" className="absolute left-1/2 -translate-x-1/2 translate-y-5 rounded bg-pink-600 px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-white shadow">
            {BOX_LABEL[shownBox]} {SIDE_LABEL[side]} · {shown} px
          </span>
        )}
      </div>
    )
  }

  const band = active && active.box === 'padding' ? Math.min(height, active.px * scale) : 0
  return (
    <>
      {active && <div className="pointer-events-auto fixed inset-0 z-30 cursor-ns-resize" data-testid="spacing-cover" aria-hidden />}
      {band > 0 && (
        <div
          aria-hidden
          className="pointer-events-none absolute z-10 bg-pink-600/15"
          style={{ left, width, height: band, top: active!.side === 'top' ? top : top + height - band }}
        />
      )}
      {grip('top')}
      {grip('bottom')}
    </>
  )
}
