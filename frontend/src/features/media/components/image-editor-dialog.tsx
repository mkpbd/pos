import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { CropIcon, CrosshairIcon, FlipHorizontal2Icon, FlipVertical2Icon, Loader2Icon, RotateCcwIcon, RotateCwIcon, SunIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useEditMediaMutation, useMediaUsageQuery, useUpdateMediaFocalMutation, type MediaItem } from '@/features/media/api'
import {
  ADJUST_MAX,
  ADJUST_MIN,
  ASPECTS,
  aspectRatio,
  displayedSize,
  editPayload,
  filterCss,
  fitAspect,
  focalPercent,
  fullRect,
  hasPixelChanges,
  moveRect,
  NO_ADJUSTMENTS,
  NO_ORIENTATION,
  previewUrl,
  rectToSource,
  reorient,
  resizeRect,
  roundRect,
  turn,
  type Adjustments,
  type AspectKey,
  type EditState,
  type Handle,
  type Orientation,
  type Point,
  type Size,
} from '@/features/media/editor/geometry'
import { ApiError } from '@/lib/api/client'
import { cn } from '@/lib/utils'

type Tool = 'crop' | 'turn' | 'light' | 'focal'

const STAGE_MAX_HEIGHT = 440

const initialState = (item: MediaItem): EditState => ({
  orientation: NO_ORIENTATION,
  adjust: NO_ADJUSTMENTS,
  crop: fullRect({ w: item.width, h: item.height }),
  focal: item.focal ? { x: (item.focal.x / 100) * item.width, y: (item.focal.y / 100) * item.height } : null,
})

const ADJUST_FIELDS: { key: keyof Adjustments; label: string }[] = [
  { key: 'brightness', label: 'Brightness' },
  { key: 'contrast', label: 'Contrast' },
  { key: 'saturation', label: 'Colour strength' },
]

/**
 * B11 picture editor: crop (free or a fixed shape; drag the box or its corners, or use the
 * arrow keys), turn and flip, brightness / contrast / colour strength, and the focal point
 * (the part that stays visible when the shop crops the picture). The preview uses CSS; the
 * server makes the real file with the same maths. Saved as a new copy by default; "Replace
 * the original" first shows where the picture is used and asks to confirm.
 */
export function ImageEditorDialog({ item, onClose, onSaved }: { item: MediaItem | null; onClose: () => void; onSaved?: (saved: MediaItem, mode: 'copy' | 'replace' | 'focal') => void }) {
  return (
    <Dialog open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[94svh] overflow-y-auto sm:max-w-4xl">
        {item && <Editor key={item.id} item={item} onClose={onClose} onSaved={onSaved} />}
      </DialogContent>
    </Dialog>
  )
}

function Editor({ item, onClose, onSaved }: { item: MediaItem; onClose: () => void; onSaved?: (saved: MediaItem, mode: 'copy' | 'replace' | 'focal') => void }) {
  const source: Size = { w: item.width, h: item.height }
  const [tool, setTool] = useState<Tool>('crop')
  const [aspect, setAspect] = useState<AspectKey>('free')
  const [state, setState] = useState<EditState>(() => initialState(item))
  const [mode, setMode] = useState<'copy' | 'replace'>('copy')
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [conflictPlaces, setConflictPlaces] = useState<string[] | null>(null)
  const edit = useEditMediaMutation()
  const saveFocal = useUpdateMediaFocalMutation()

  const ratio = aspectRatio(aspect)
  const display = displayedSize(source, state.orientation.rotate)
  const pixelChanges = hasPixelChanges(state, source)
  const usage = useMediaUsageQuery(item.id, pixelChanges && mode === 'replace')
  const places = conflictPlaces ?? usage.data?.places ?? []
  const output = roundRect(rectToSource(state.crop, source, state.orientation), source)
  const outputSize = state.orientation.rotate % 180 === 0 ? output : { ...output, w: output.h, h: output.w }
  const focalNow = state.focal ? focalPercent(state.focal, state.crop) : null
  const focalChanged = (focalNow?.x ?? null) !== (item.focal?.x ?? null) || (focalNow?.y ?? null) !== (item.focal?.y ?? null)
  const pending = edit.isPending || saveFocal.isPending

  const setOrientation = (next: Orientation) => setState((s) => reorient(s, source, next, ratio))
  const chooseAspect = (key: AspectKey) => {
    setAspect(key)
    setState((s) => ({ ...s, crop: fitAspect(displayedSize(source, s.orientation.rotate), aspectRatio(key)) }))
  }

  const save = () => {
    if (!pixelChanges) {
      saveFocal.mutate(
        { id: item.id, focal: focalNow },
        {
          onSuccess: (saved) => {
            toast.success(focalNow ? 'Focal point saved.' : 'Focal point reset to the centre.')
            onSaved?.(saved, 'focal')
            onClose()
          },
          onError: (e) => toast.error(e.message),
        },
      )
      return
    }
    const needsConfirm = mode === 'replace' && places.length > 0
    edit.mutate(
      { id: item.id, input: { ...editPayload(state, source), mode, ...(needsConfirm && confirmReplace ? { confirm_replace: true } : {}) } },
      {
        onSuccess: (saved) => {
          toast.success(mode === 'replace' ? 'Picture replaced everywhere it is used.' : `Edited copy saved as ${saved.original_name}.`)
          onSaved?.(saved, mode)
          onClose()
        },
        onError: (e) => {
          if (e instanceof ApiError && e.code === 'IN_USE' && Array.isArray(e.details.places)) {
            setConflictPlaces(e.details.places.map(String))
            setConfirmReplace(false)
            return
          }
          toast.error(e.message)
        },
      },
    )
  }

  const replaceBlocked = mode === 'replace' && (usage.isPending || (places.length > 0 && !confirmReplace))

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit picture</DialogTitle>
        <DialogDescription>
          {item.original_name} · {item.width}×{item.height}. Your changes are saved as a new copy unless you choose to replace the original.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_17rem]">
        <Stage item={item} source={source} display={display} state={state} setState={setState} tool={tool} ratio={ratio} />

        <Tabs value={tool} onValueChange={(v) => setTool(v as Tool)} className="min-w-0">
          <TabsList className="grid h-auto! w-full grid-cols-4" aria-label="Picture tools">
            <TabsTrigger value="crop" aria-label="Crop" className="flex-col gap-0.5 py-1 text-xs"><CropIcon />Crop</TabsTrigger>
            <TabsTrigger value="turn" aria-label="Turn and flip" className="flex-col gap-0.5 py-1 text-xs"><RotateCwIcon />Turn</TabsTrigger>
            <TabsTrigger value="light" aria-label="Light and colour" className="flex-col gap-0.5 py-1 text-xs"><SunIcon />Light</TabsTrigger>
            <TabsTrigger value="focal" aria-label="Focal point" className="flex-col gap-0.5 py-1 text-xs"><CrosshairIcon />Focal</TabsTrigger>
          </TabsList>

          <TabsContent value="crop" className="flex flex-col gap-3 pt-2">
            <h3 className="text-sm font-medium">Crop</h3>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Crop shape">
              {ASPECTS.map((a) => (
                <Button key={a.key} type="button" size="sm" variant={aspect === a.key ? 'default' : 'outline'} aria-pressed={aspect === a.key} onClick={() => chooseAspect(a.key)}>
                  {a.label}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Drag the box or its corners. With the box selected, arrow keys move it and Shift + arrow keys change its size.</p>
            <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => chooseAspect('free')}>Reset crop</Button>
          </TabsContent>

          <TabsContent value="turn" className="flex flex-col gap-3 pt-2">
            <h3 className="text-sm font-medium">Turn and flip</h3>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setOrientation({ ...state.orientation, rotate: turn(state.orientation.rotate, -90) })}><RotateCcwIcon data-icon="inline-start" /> Turn left</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setOrientation({ ...state.orientation, rotate: turn(state.orientation.rotate, 90) })}><RotateCwIcon data-icon="inline-start" /> Turn right</Button>
              <Button type="button" variant="outline" size="sm" aria-pressed={state.orientation.flipH} onClick={() => setOrientation({ ...state.orientation, flipH: !state.orientation.flipH })}><FlipHorizontal2Icon data-icon="inline-start" /> Mirror</Button>
              <Button type="button" variant="outline" size="sm" aria-pressed={state.orientation.flipV} onClick={() => setOrientation({ ...state.orientation, flipV: !state.orientation.flipV })}><FlipVertical2Icon data-icon="inline-start" /> Upside down</Button>
            </div>
          </TabsContent>

          <TabsContent value="light" className="flex flex-col gap-3 pt-2">
            <h3 className="text-sm font-medium">Light and colour</h3>
            {ADJUST_FIELDS.map((f) => (
              <AdjustSlider key={f.key} label={f.label} value={state.adjust[f.key]} onChange={(v) => setState((s) => ({ ...s, adjust: { ...s.adjust, [f.key]: v } }))} />
            ))}
            <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setState((s) => ({ ...s, adjust: NO_ADJUSTMENTS }))}>Reset light and colour</Button>
          </TabsContent>

          <TabsContent value="focal" className="flex flex-col gap-3 pt-2">
            <h3 className="text-sm font-medium">Focal point</h3>
            <p className="text-xs text-muted-foreground">Click the most important part of the picture. When the shop shows it cut to a square or a wide strip, this part stays in view. With the point selected, arrow keys move it.</p>
            <p className="text-sm" aria-live="polite">{focalNow ? `${focalNow.x}% across, ${focalNow.y}% down` : 'Centre (not set)'}</p>
            {focalNow && !state.orientation.rotate && !state.orientation.flipH && !state.orientation.flipV && pixelChanges === false && <FocalPreviews item={item} focal={focalNow} />}
            <Button type="button" variant="ghost" size="sm" className="self-start" disabled={!state.focal} onClick={() => setState((s) => ({ ...s, focal: null }))}>Reset to the centre</Button>
          </TabsContent>
        </Tabs>
      </div>

      {pixelChanges && (
        <fieldset className="flex flex-col gap-2 rounded-md border p-3">
          <legend className="px-1 text-sm font-medium">Save as</legend>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="edit-mode" className="mt-1" checked={mode === 'copy'} onChange={() => setMode('copy')} />
            <span>A new copy <span className="text-muted-foreground">— the original stays as it is</span></span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="edit-mode" className="mt-1" checked={mode === 'replace'} onChange={() => setMode('replace')} />
            <span>Replace the original <span className="text-muted-foreground">— everywhere it is used</span></span>
          </label>
          {mode === 'replace' && (
            <div className="text-sm" aria-live="polite">
              {usage.isPending && !conflictPlaces ? (
                <span className="text-muted-foreground">Checking where this picture is used…</span>
              ) : places.length > 0 ? (
                <div className="flex flex-col gap-2 rounded-md border border-warning/50 bg-warning/10 p-2 text-warning-soft-foreground">
                  <span>This picture is used in:</span>
                  <ul className="list-disc pl-5">{places.map((p) => <li key={p}>{p}</li>)}</ul>
                  <label className="flex items-center gap-2">
                    <Checkbox checked={confirmReplace} onCheckedChange={(v) => setConfirmReplace(v === true)} aria-label="Replace it in these places too" />
                    Replace it in these places too
                  </label>
                </div>
              ) : (
                <span className="text-muted-foreground">This picture is not used anywhere yet.</span>
              )}
            </div>
          )}
          <p className="text-xs text-muted-foreground">Result: {outputSize.w}×{outputSize.h} px</p>
        </fieldset>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="button" onClick={save} disabled={pending || (!pixelChanges && !focalChanged) || (pixelChanges && replaceBlocked)}>
          {pending && <Loader2Icon data-icon="inline-start" className="animate-spin motion-reduce:animate-none" />}
          {pixelChanges ? (mode === 'replace' ? 'Replace picture' : 'Save copy') : focalChanged ? 'Save focal point' : 'Save'}
        </Button>
      </DialogFooter>
    </>
  )
}

function AdjustSlider({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-sm">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id} className="tabular-nums text-muted-foreground">{value > 0 ? `+${value}` : value}</output>
      </div>
      <input id={id} type="range" min={ADJUST_MIN} max={ADJUST_MAX} step={1} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-primary" />
    </div>
  )
}

/** How the focal point keeps the subject in view when the shop crops the picture. */
function FocalPreviews({ item, focal }: { item: MediaItem; focal: { x: number; y: number } }) {
  const src = previewUrl(item.url, item.srcset, 320)
  const style = { objectPosition: `${focal.x}% ${focal.y}%` }
  return (
    <div className="flex items-end gap-2" aria-label="How the shop may cut the picture" role="group">
      <img src={src} alt="" className="size-16 rounded border object-cover" style={style} />
      <img src={src} alt="" className="h-12 w-28 rounded border object-cover" style={style} />
      <img src={src} alt="" className="h-20 w-12 rounded border object-cover" style={style} />
    </div>
  )
}

type Drag = { kind: 'move' } | { kind: 'resize'; handle: Handle }

/** The picture as it will look, with the crop box and the focal point on top. */
function Stage({ item, source, display, state, setState, tool, ratio }: {
  item: MediaItem
  source: Size
  display: Size
  state: EditState
  setState: (update: (s: EditState) => EditState) => void
  tool: Tool
  ratio: number | null
}) {
  const box = useRef<HTMLDivElement>(null)
  const [available, setAvailable] = useState(560)
  const drag = useRef<{ drag: Drag; x: number; y: number; start: EditState['crop'] } | null>(null)
  const hintId = useId()

  useEffect(() => {
    const el = box.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => entry && setAvailable(Math.max(160, entry.contentRect.width)))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const scale = Math.min(available / display.w, STAGE_MAX_HEIGHT / display.h, 4)
  const { rotate, flipH, flipV } = state.orientation
  const crop = state.crop
  const src = previewUrl(item.url, item.srcset)

  const startDrag = (e: ReactPointerEvent, kind: Drag) => {
    if (tool !== 'crop') return
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    drag.current = { drag: kind, x: e.clientX, y: e.clientY, start: crop }
  }
  const onDrag = (e: ReactPointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = (e.clientX - d.x) / scale
    const dy = (e.clientY - d.y) / scale
    setState((s) => ({ ...s, crop: d.drag.kind === 'move' ? moveRect(d.start, dx, dy, display) : resizeRect(d.start, d.drag.handle, dx, dy, display, ratio) }))
  }
  const endDrag = () => {
    drag.current = null
  }

  const onCropKey = (e: KeyboardEvent) => {
    const step = Math.max(1, Math.round(Math.max(display.w, display.h) / 100))
    const dirs: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    const dir = dirs[e.key]
    if (!dir) return
    e.preventDefault()
    setState((s) => ({ ...s, crop: e.shiftKey ? resizeRect(s.crop, 'se', dir[0], dir[1], display, ratio) : moveRect(s.crop, dir[0], dir[1], display) }))
  }

  const placeFocal = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (tool !== 'focal') return
    const rect = e.currentTarget.getBoundingClientRect()
    const p: Point = { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale }
    setState((s) => ({ ...s, focal: { x: Math.min(Math.max(p.x, s.crop.x), s.crop.x + s.crop.w), y: Math.min(Math.max(p.y, s.crop.y), s.crop.y + s.crop.h) } }))
  }
  const onFocalKey = (e: KeyboardEvent) => {
    const big = e.shiftKey ? 10 : 1
    const sx = (crop.w / 100) * big
    const sy = (crop.h / 100) * big
    const dirs: Record<string, [number, number]> = { ArrowLeft: [-sx, 0], ArrowRight: [sx, 0], ArrowUp: [0, -sy], ArrowDown: [0, sy] }
    const dir = dirs[e.key]
    if (!dir) return
    e.preventDefault()
    setState((s) => {
      const f = s.focal ?? { x: s.crop.x + s.crop.w / 2, y: s.crop.y + s.crop.h / 2 }
      return { ...s, focal: { x: Math.min(Math.max(f.x + dir[0], s.crop.x), s.crop.x + s.crop.w), y: Math.min(Math.max(f.y + dir[1], s.crop.y), s.crop.y + s.crop.h) } }
    })
  }

  const focal = state.focal ?? (tool === 'focal' ? { x: crop.x + crop.w / 2, y: crop.y + crop.h / 2 } : null)
  const focalPct = focal ? focalPercent(focal, crop) : null
  const cropSize = roundRect(rectToSource(crop, source, state.orientation), source)

  return (
    <div ref={box} className="flex min-w-0 justify-center rounded-md bg-[repeating-conic-gradient(#e5e7eb_0_25%,#f9fafb_0_50%)] bg-[length:16px_16px] p-2">
      <div
        data-testid="editor-stage"
        className={cn('relative touch-none overflow-hidden select-none', tool === 'focal' && 'cursor-crosshair')}
        style={{ width: display.w * scale, height: display.h * scale }}
        onPointerDown={placeFocal}
        onPointerMove={onDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <img
          src={src}
          alt={item.alt ?? item.original_name}
          draggable={false}
          className="pointer-events-none absolute top-1/2 left-1/2 max-w-none"
          style={{
            width: source.w * scale,
            height: source.h * scale,
            transform: `translate(-50%, -50%) scale(${flipH ? -1 : 1}, ${flipV ? -1 : 1}) rotate(${rotate}deg)`,
            filter: filterCss(state.adjust),
          }}
        />
        {/* Crop box: everything outside is dimmed. */}
        <div
          role="group"
          aria-roledescription="crop box"
          aria-label={`Crop area, ${cropSize.w} × ${cropSize.h} pixels`}
          aria-describedby={hintId}
          tabIndex={tool === 'crop' ? 0 : -1}
          data-testid="crop-box"
          onKeyDown={tool === 'crop' ? onCropKey : undefined}
          onPointerDown={(e) => startDrag(e, { kind: 'move' })}
          className={cn(
            'absolute border border-dashed border-black/60 outline-2 outline-white shadow-[0_0_0_9999px_rgb(0_0_0/0.5)] focus-visible:outline-4 focus-visible:outline-primary',
            tool === 'crop' ? 'cursor-move' : 'pointer-events-none',
          )}
          style={{ left: crop.x * scale, top: crop.y * scale, width: crop.w * scale, height: crop.h * scale }}
        >
          {tool === 'crop' &&
            (['nw', 'ne', 'sw', 'se'] as const).map((h) => (
              <span
                key={h}
                aria-hidden
                data-handle={h}
                onPointerDown={(e) => startDrag(e, { kind: 'resize', handle: h })}
                className={cn(
                  'absolute size-4 rounded-sm border-2 border-primary bg-white',
                  h === 'nw' && '-top-2 -left-2 cursor-nwse-resize',
                  h === 'ne' && '-top-2 -right-2 cursor-nesw-resize',
                  h === 'sw' && '-bottom-2 -left-2 cursor-nesw-resize',
                  h === 'se' && '-right-2 -bottom-2 cursor-nwse-resize',
                )}
              />
            ))}
        </div>
        <span id={hintId} className="sr-only">Arrow keys move the box; Shift and arrow keys change its size.</span>
        {focal && focalPct && (
          <div
            role="slider"
            aria-label="Focal point"
            aria-valuetext={`${focalPct.x}% across, ${focalPct.y}% down`}
            aria-valuenow={focalPct.x}
            aria-valuemin={0}
            aria-valuemax={100}
            tabIndex={tool === 'focal' ? 0 : -1}
            onKeyDown={tool === 'focal' ? onFocalKey : undefined}
            data-testid="focal-marker"
            className={cn(
              'absolute size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-primary/60 shadow ring-1 ring-black/40 focus-visible:ring-4 focus-visible:ring-primary',
              tool !== 'focal' && 'pointer-events-none opacity-70',
            )}
            style={{ left: focal.x * scale, top: focal.y * scale }}
          />
        )}
      </div>
    </div>
  )
}
