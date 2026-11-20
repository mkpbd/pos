import type { Rect } from '@/storefront/builder/canvas/protocol'
import { cn } from '@/lib/utils'
import type { CommentAnchor } from './collab-api'
import { pinPoint } from './collab-model'

/*
 * B16: numbered comment pins drawn over the canvas at their anchors (open threads only; the
 * active one stands out). A pin opens its thread in the Comments panel.
 */

export type CommentPin = {
  id: string
  number: number
  /** The canvas node the pin is drawn on (a global section reference: its drawn section). */
  drawId: string
  anchor: CommentAnchor | null
  active: boolean
  /** "Comment 3 by Rima: Make this bigger" */
  label: string
}

export type CommentPinLayer = { pins: CommentPin[]; onPick: (id: string) => void }

export function CommentPins({ layer, rects, scale }: { layer: CommentPinLayer; rects: Record<string, Rect>; scale: number }) {
  return (
    <>
      {layer.pins.map((pin) => {
        const rect = rects[pin.drawId]
        if (!rect || rect.h <= 0) return null
        const at = pinPoint(rect, pin.anchor)
        return (
          <button
            key={pin.id}
            type="button"
            data-testid={`comment-pin-${pin.id}`}
            aria-label={pin.label}
            title={pin.label}
            aria-pressed={pin.active}
            onClick={() => layer.onPick(pin.id)}
            className={cn(
              'pointer-events-auto absolute z-20 flex size-7 -translate-y-full items-center justify-center rounded-full rounded-bl-none border-2 border-white text-xs font-bold text-white shadow-md outline-none focus-visible:ring-3 focus-visible:ring-blue-400',
              pin.active ? 'scale-110 bg-blue-700' : 'bg-neutral-800',
            )}
            style={{ left: at.x * scale, top: at.y * scale }}
          >
            {pin.number}
          </button>
        )
      })}
    </>
  )
}
