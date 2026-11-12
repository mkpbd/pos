import { useEffect, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { Rect } from '@/storefront/builder/canvas/protocol'
import { MIN_WIDTH, resizePair, SNAP, sideBySide } from './column-resize'

/*
 * Drag handles between the columns of the selected row on the canvas (B3), for the device being
 * edited: drag to move width from one column to its neighbour (snaps to 5 %, the % shows while
 * dragging), or focus a handle and use ← / → (5 % per press). Handles appear only between
 * columns that sit side by side on this device.
 */

export type ResizeRow = { rowId: string; columns: { id: string; width: number }[] }

export type ResizePhase = 'move' | 'end'

type Active = { index: number; startX: number; startLeft: number; pxPerPercent: number; widths: number[]; left: number }

export function ColumnHandles({ row, rects, scale, onResize }: {
  row: ResizeRow
  rects: Record<string, Rect>
  scale: number
  onResize: (rowId: string, index: number, left: number, phase: ResizePhase) => void
}) {
  const [active, setActive] = useState<Active | null>(null)
  const widths = row.columns.map((c) => c.width)

  // While dragging, the pointer is followed on the window (a cover keeps it off the iframe).
  useEffect(() => {
    if (!active) return
    const leftAt = (clientX: number) => active.startLeft + (clientX - active.startX) / active.pxPerPercent
    const onMove = (event: globalThis.PointerEvent) => {
      const left = leftAt(event.clientX)
      setActive((a) => (a ? { ...a, left } : a))
      onResize(row.rowId, active.index, left, 'move')
    }
    const onUp = (event: globalThis.PointerEvent) => {
      onResize(row.rowId, active.index, leftAt(event.clientX), 'end')
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
    // Only a new drag (index / start) re-subscribes; `left` changes while dragging.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.index, active?.startX, row.rowId, onResize])

  const handles = row.columns.slice(0, -1).map((column, index) => {
    const next = row.columns[index + 1]!
    const a = rects[column.id]
    const b = rects[next.id]
    if (!a || !b || a.h <= 0 || b.h <= 0) return null
    // Side by side on this device: their widths fit in the row and the right one starts after the left one.
    if (!sideBySide(widths, index) || b.x < a.x + a.w - 2 || b.y > a.y + a.h) return null
    const x = ((a.x + a.w + b.x) / 2) * scale
    const top = Math.min(a.y, b.y) * scale
    const height = Math.max(24, (Math.max(a.y + a.h, b.y + b.h) - Math.min(a.y, b.y)) * scale)
    const dragging = active?.index === index
    const pair = dragging ? resizePair(active.widths, index, active.left) : null
    const total = widths[index]! + widths[index + 1]!

    const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      // Client pixels per percent of the row, from the two columns' drawn widths.
      const pxPerPercent = ((a.w + b.w) * scale) / total
      if (!(pxPerPercent > 0)) return
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // Not supported (tests): the window listeners still follow the pointer over the cover.
      }
      setActive({ index, startX: event.clientX, startLeft: widths[index]!, pxPerPercent, widths, left: widths[index]! })
    }
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      event.stopPropagation()
      onResize(row.rowId, index, widths[index]! + (event.key === 'ArrowRight' ? SNAP : -SNAP), 'end')
    }

    return (
      <div
        key={column.id}
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-label={`Width of columns ${index + 1} and ${index + 2}`}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={total - MIN_WIDTH}
        aria-valuenow={widths[index]}
        aria-valuetext={`${widths[index]} % and ${widths[index + 1]} %`}
        title="Drag to change the column widths (← → with the keyboard)"
        data-testid={`column-resize-${column.id}`}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        className="group pointer-events-auto absolute z-20 flex w-3 -translate-x-1/2 cursor-col-resize touch-none items-center justify-center outline-none"
        style={{ left: x, top, height }}
      >
        <span className={`h-full w-1 rounded-full ${dragging ? 'bg-blue-600' : 'bg-blue-600/60 group-hover:bg-blue-600 group-focus-visible:bg-blue-600'}`} aria-hidden />
        <span className="absolute top-1/2 size-3 -translate-y-1/2 rounded-full border-2 border-white bg-blue-600 shadow" aria-hidden />
        {(dragging || pair) && (
          <span data-testid="column-resize-label" className="absolute top-1/2 left-1/2 -translate-x-1/2 translate-y-3 rounded bg-blue-600 px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-white shadow">
            {pair ? `${pair[0]} % | ${pair[1]} %` : `${widths[index]} % | ${widths[index + 1]} %`}
          </span>
        )}
      </div>
    )
  })

  return (
    <>
      {active && <div className="pointer-events-auto fixed inset-0 z-30 cursor-col-resize" data-testid="column-resize-cover" aria-hidden />}
      {handles}
    </>
  )
}
