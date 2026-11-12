/*
 * B6: the shop-the-look hotspot editor. Click the picture to place a dot, drag a dot to move it,
 * pick a product for each dot. Keyboard: Tab to a dot, arrows nudge it (1 %, Shift 5 %), Delete
 * removes it. Positions are percent of the picture (0–100, 2 decimals), so they stay put on every
 * screen size. A new dot has no product yet (`product_id` ''), which the validation reports.
 */

import { useId, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'
import { ImageIcon, Trash2Icon } from 'lucide-react'
import { useMediaLookup } from '@/features/media/api'
import { useProductNames } from '@/features/products/api'
import { cn } from '@/lib/utils'
import type { Hotspot } from '@/storefront/builder/types'
import { B6_LIMITS } from '@/storefront/builder/validate'
import { FieldError } from './fields'
import { clampPercent, newItemId } from './b6-model'
import { SingleProductPicker } from './pickers'


const HOTSPOT_LIMITS = B6_LIMITS.hotspots

export type HotspotEditorProps = {
  mediaId: string | null
  /** The picture's address when known already (just chosen); otherwise it's looked up. */
  imageUrl?: string | null
  hotspots: readonly Hotspot[]
  onChange: (hotspots: Hotspot[], change?: { typing?: string; removed?: string }) => void
  /** Problems by form key (`hotspots`, `hotspots.<i>.product_id`, …). */
  errors?: Record<string, string>
}

export function HotspotEditor({ mediaId, imageUrl, hotspots, onChange, errors = {} }: HotspotEditorProps) {
  const areaRef = useRef<HTMLDivElement>(null)
  const keysId = useId()
  const drag = useRef<{ id: string } | null>(null)
  const [selected, setSelected] = useState<string | null>(hotspots[0]?.id ?? null)
  const { byId } = useMediaLookup(mediaId && !imageUrl ? [mediaId] : [])
  const src = imageUrl ?? (mediaId ? byId.get(mediaId)?.url : undefined)
  const names = useProductNames(hotspots.map((h) => h.product_id).filter((id): id is string => !!id))
  const full = hotspots.length >= HOTSPOT_LIMITS.max
  const current = hotspots.find((h) => h.id === selected) ?? null
  const currentIndex = current ? hotspots.indexOf(current) : -1

  const pointAt = (clientX: number, clientY: number) => {
    const box = areaRef.current?.getBoundingClientRect()
    if (!box || box.width === 0 || box.height === 0) return null
    return { x: clampPercent(((clientX - box.left) / box.width) * 100), y: clampPercent(((clientY - box.top) / box.height) * 100) }
  }
  const move = (id: string, x: number, y: number, typing = `hotspot.${id}.move`) =>
    onChange(hotspots.map((h) => (h.id === id ? { ...h, x: clampPercent(x), y: clampPercent(y) } : h)), { typing })
  const remove = (id: string) => {
    if (hotspots.length <= HOTSPOT_LIMITS.min) return
    const index = hotspots.findIndex((h) => h.id === id)
    const rest = hotspots.filter((h) => h.id !== id)
    onChange(rest, { removed: id })
    setSelected(rest[Math.min(index, rest.length - 1)]?.id ?? null)
  }

  const onAreaClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget && !(event.target instanceof HTMLImageElement)) return
    if (full || !src) return
    const point = pointAt(event.clientX, event.clientY)
    if (!point) return
    const id = newItemId(hotspots, 'h')
    onChange([...hotspots, { id, ...point, product_id: '' }])
    setSelected(id)
  }

  const onDotPointerDown = (id: string) => (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    event.currentTarget.focus()
    drag.current = { id }
    setSelected(id)
  }
  const onDotPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current
    if (!d) return
    const point = pointAt(event.clientX, event.clientY)
    if (!point) return
    move(d.id, point.x, point.y)
  }
  const onDotPointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    drag.current = null
  }
  const onDotKey = (h: Hotspot) => (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.shiftKey ? 5 : 1
    const delta: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    const d = delta[event.key]
    if (d) {
      event.preventDefault()
      move(h.id, h.x + d[0], h.y + d[1], `hotspot.${h.id}.nudge`)
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      event.stopPropagation()
      remove(h.id)
    }
  }

  const dotName = (h: Hotspot, i: number) => `Hotspot ${i + 1}: ${h.product_id ? (names.get(h.product_id)?.name ?? 'product') : 'no product yet'}`

  return (
    <div className="flex flex-col gap-3" data-testid="hotspot-editor">
      <div className="flex items-center gap-2">
        <h3 className="flex-1 text-sm font-medium">Hotspots</h3>
        <span className="text-xs text-muted-foreground tabular-nums">{hotspots.length} of {HOTSPOT_LIMITS.max}</span>
      </div>
      {src ? (
        <div
          ref={areaRef}
          data-testid="hotspot-area"
          onClick={onAreaClick}
          className={cn('relative w-full touch-none overflow-hidden rounded-md border bg-muted select-none', full ? 'cursor-default' : 'cursor-crosshair')}
        >
          <img src={src} alt="" draggable={false} className="block h-auto w-full" />
          {hotspots.map((h, i) => {
            const active = h.id === selected
            const problem = Object.keys(errors).some((k) => k.startsWith(`hotspots.${i}.`)) || !h.product_id
            return (
              <button
                key={h.id}
                type="button"
                aria-label={dotName(h, i)}
                aria-pressed={active}
                aria-describedby={keysId}
                data-testid="hotspot-dot"
                style={{ left: `${h.x}%`, top: `${h.y}%` }}
                onClick={(e) => {
                  e.stopPropagation()
                  setSelected(h.id)
                }}
                onPointerDown={onDotPointerDown(h.id)}
                onPointerMove={onDotPointerMove}
                onPointerUp={onDotPointerUp}
                onPointerCancel={onDotPointerUp}
                onKeyDown={onDotKey(h)}
                className={cn(
                  'absolute flex size-7 -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center rounded-full border-2 border-white text-xs font-bold text-white shadow-md outline-none active:cursor-grabbing',
                  'focus-visible:ring-3 focus-visible:ring-ring',
                  active ? 'bg-primary ring-2 ring-primary ring-offset-1' : problem ? 'bg-destructive' : 'bg-neutral-900/80',
                )}
              >
                {i + 1}
              </button>
            )
          })}
        </div>
      ) : (
        <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed text-sm text-muted-foreground">
          <ImageIcon className="size-6" aria-hidden />
          {mediaId ? 'Loading the picture…' : 'Choose the picture first.'}
        </div>
      )}
      <p id={keysId} className="text-xs text-muted-foreground">
        {full ? `All ${HOTSPOT_LIMITS.max} hotspots are placed.` : 'Click the picture to place a hotspot.'} Drag a hotspot to move it, or select it and use the arrow keys (Shift for bigger steps); Delete removes it.
      </p>
      <FieldError message={errors.hotspots} />

      {hotspots.length > 0 && (
        <div role="group" aria-label="Choose a hotspot" className="flex flex-wrap gap-1.5">
          {hotspots.map((h, i) => (
            <button
              key={h.id}
              type="button"
              aria-pressed={h.id === selected}
              onClick={() => setSelected(h.id)}
              className={cn(
                'flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring',
                h.id === selected && 'border-primary bg-primary/10',
                !h.product_id && 'border-destructive/60 text-destructive',
              )}
            >
              {i + 1}. {h.product_id ? (names.get(h.product_id)?.name ?? 'Product') : 'Choose product'}
            </button>
          ))}
        </div>
      )}

      {current && (
        <fieldset className="flex flex-col gap-3 rounded-md border p-3" data-testid="hotspot-detail">
          <legend className="px-1 text-sm font-medium">Hotspot {currentIndex + 1}</legend>
          <SingleProductPicker
            value={current.product_id || null}
            error={errors[`hotspots.${currentIndex}.product_id`] ?? (current.product_id ? undefined : 'Choose the product this hotspot shows.')}
            onChange={(product_id) => onChange(hotspots.map((h) => (h.id === current.id ? { ...h, product_id } : h)))}
          />
          <div className="grid grid-cols-2 gap-2">
            <PercentInput label="Across (%)" value={current.x} onChange={(x) => move(current.id, x, current.y, `hotspot.${current.id}.x`)} />
            <PercentInput label="Down (%)" value={current.y} onChange={(y) => move(current.id, current.x, y, `hotspot.${current.id}.y`)} />
          </div>
          <button
            type="button"
            disabled={hotspots.length <= HOTSPOT_LIMITS.min}
            onClick={() => remove(current.id)}
            className="flex items-center gap-1.5 self-start rounded text-sm text-destructive outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
          >
            <Trash2Icon className="size-4" aria-hidden /> Remove hotspot {currentIndex + 1}
          </button>
        </fieldset>
      )}
    </div>
  )
}

function PercentInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const [text, setText] = useState(String(value))
  const [seen, setSeen] = useState(value)
  if (seen !== value) {
    setSeen(value)
    setText(String(value))
  }
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <input
        type="number"
        min={0}
        max={100}
        step={0.5}
        inputMode="decimal"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          const n = Number(e.target.value)
          if (e.target.value !== '' && Number.isFinite(n)) onChange(clampPercent(n))
        }}
        className="h-8 rounded-md border bg-transparent px-2 tabular-nums shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      />
    </label>
  )
}
