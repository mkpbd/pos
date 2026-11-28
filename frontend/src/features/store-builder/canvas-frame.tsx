import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react'
import { envelope, PAGE_DROP_ID, readCanvasMessage, type CanvasMessage, type CanvasProduct, type CanvasSurroundings, type FileDropHover, type ParentMessage, type Rect } from '@/storefront/builder/canvas/protocol'
import type { BuilderData, BuilderMedia, Device, DeviceOrder, PopupSettings, RenderSection, ScrollProgress } from '@/storefront/builder/types'
import type { StorefrontBootstrap } from '@/storefront/types'
import type { CanvasThemeSettings } from '@/storefront/builder/canvas/theme-override'
import type { FontSource } from '@/storefront/fonts'
import { cn } from '@/lib/utils'
import { CANVAS_URL, DEVICE_WIDTHS } from './canvas-config'
import { ColumnHandles, type ResizePhase, type ResizeRow } from './column-handles'
import { toolbarPosition } from './toolbar-position'
import type { DropIndicator } from './drop-targets'
import { dropLabel } from './file-drop'
import { SpacingHandles, type SpacingPhase, type SpacingValues } from './spacing-handles'
import type { SpacingGuide } from './snapping'
import type { SpacingBox, SpacingSide } from './spacing-drag'
import { HeatOverlay, type HeatLayer } from './insights/heat-overlay'
import { ArmSwitchers, type ArmSwitchLayer } from './experiments/arm-switchers'
import type { PreviewContext } from '@/storefront/builder/audience/types'
import { AudienceCanvasBadges } from './audience/audience-badge'
import type { CanvasAudienceBadge } from './audience/badges'
import type { StorePageContext, StorePageSample } from '@/storefront/builder/templates/types'
import { CommentPins, type CommentPinLayer } from './collab/comment-pins'
import { revealItem } from './inspector/item-reveal'

/*
 * The canvas iframe (/admin/builder-canvas) at the device width, scaled to fit, with the editor's
 * overlay on top: hover label, the selected node's mini toolbar and, while dragging, a layer that
 * catches the pointer (the iframe would swallow it) and draws the drop indicator.
 */


export type CanvasHandle = {
  scrollTo: (id: string) => void
  scrollBy: (dy: number) => void
  /** B6: replays the node's entrance animation once. */
  /** B18: `scope` page plays every entrance top to bottom (the id is ignored); section: the id's section in order. */
  playMotion: (id: string, scope?: 'node' | 'section' | 'page') => void
  /** B19: scrolls the node through the canvas screen once, playing its scroll effect. */
  previewScroll: (id: string) => void
  /** A client (parent window) point in canvas viewport pixels; null outside the canvas. */
  toCanvasPoint: (clientX: number, clientY: number) => { x: number; y: number } | null
  rects: () => Record<string, Rect>
  viewport: () => { w: number; h: number }
  /** B10: starts editing a text in place (no field: the node's first shown field). */
  editText: (id: string, field?: string) => void
  /** B10: finishes the edit in progress (selection change, undo, device switch): commit or cancel. */
  endTextEdit: (commit: boolean) => void
  /** B10: the answer to the format bar's Link button (a URL, '' = remove the link, null = cancelled). */
  linkResult: (url: string | null) => void
  /** B10: the node whose text is being edited on the canvas (null: none). */
  editing: () => string | null
  /** B10: sends the render again although nothing changed (after a refused text edit the canvas shows the old text). */
  rerender: () => void
}

/** B10: canvas messages of editing on the page (text edits, dropped pictures, "Replace picture"). */
export type CanvasEditMessage = Extract<CanvasMessage, { type: 'text-edit-start' | 'text-edit-commit' | 'text-edit-cancel' | 'text-edit-link' | 'image-drop' | 'image-replace' | 'drop-files' }>

const EDIT_TYPES: ReadonlySet<string> = new Set(['text-edit-start', 'text-edit-commit', 'text-edit-cancel', 'text-edit-link', 'image-drop', 'image-replace', 'drop-files'])

/** B10: the selected section / inner row / column's spacing handles (values in px at this device; null = can't be dragged). */
export type SpacingTarget = {
  nodeId: string
  label: string
  deviceLabel: string
  values: SpacingValues
  onChange: (box: SpacingBox, side: SpacingSide, px: number, phase: SpacingPhase) => void
  /** B12: neighbours' values the handles snap to. */
  guides?: SpacingGuide[]
}

/** B12: how a canvas click picks: Ctrl/Cmd adds or removes the item, Shift adds a range. */
export type SelectGesture = { toggle: boolean; range: boolean }

/** B10: an upload running for a node (0–1; null while the size isn't known yet). */
export type NodeUpload = { progress: number | null; name: string }

export type CanvasFrameProps = {
  bootstrap: StorefrontBootstrap
  locale: string
  sections: RenderSection[]
  data: Record<string, BuilderData>
  media: Record<string, BuilderMedia>
  pending: string[]
  selection: string | null
  /** B12: every selected id (several: each gets an outline, the toolbar spans them all). */
  selectedIds?: string[]
  hover: string | null
  errorIds: string[]
  device: Device
  dragging: boolean
  indicator: DropIndicator | null
  onSelect: (id: string | null, gesture?: SelectGesture) => void
  onHover: (id: string | null) => void
  onKey: (key: { key: string; ctrl: boolean; shift: boolean; meta: boolean }) => void
  /** The selected node's floating toolbar, placed above its rect. */
  toolbar: (rect: Rect) => ReactNode
  hoverLabel: (id: string) => string
  handleRef: Ref<CanvasHandle>
  /** B3: the theme draft's settings (instant preview of Site styles); null = the bootstrap theme. */
  theme?: CanvasThemeSettings | null
  /** B3: the row whose column widths can be dragged (the selected section / inner row / column's row), widths at this device. */
  resizeRow?: ResizeRow | null
  onResize?: (rowId: string, index: number, left: number, phase: ResizePhase) => void
  /** B4: a header, footer or zone is drawn with a faded sample of the page around it. */
  surroundings?: CanvasSurroundings
  /** B4: the canvas text while the document is empty. */
  emptyText?: string
  /** B8b: with `surroundings: 'popup'`, the popup's settings (the canvas draws its layout over a dimmed sample page). */
  popup?: PopupSettings
  /** P1b: a product page zone's preview product (its photo, name and price fill the sample around the zone). */
  product?: CanvasProduct | null
  /** B19: the draft's reading progress bar (sent with every render; absent = none). */
  scrollProgress?: ScrollProgress | null
  /** B10: the store's uploaded fonts (sent with the theme; absent = the bootstrap's fonts). */
  fonts?: FontSource[]
  /** B10: text edits, dropped pictures and "Replace picture" from the canvas. */
  onEdit?: (message: CanvasEditMessage) => void
  /** B10: spacing handles on the selection (null: none). */
  spacing?: SpacingTarget | null
  /** B10: uploads per node id, drawn as progress over the node. */
  uploads?: Record<string, NodeUpload>
  /** B12: the draft's phone / tablet order (globals merged), drawn in Tablet and Mobile view. */
  deviceOrder?: DeviceOrder | null
  /** B15: the Insights heat map (clicks per section and scroll reach) drawn over the page; null = off. */
  heat?: HeatLayer | null
  /** B13: the "Showing version A | B" switch on each A/B test's sections (null: no tests). */
  arms?: ArmSwitchLayer | null
  /** B13: the toolbar's "Preview as" (null = show everything): the canvas fades what that shopper wouldn't see. */
  previewAs?: PreviewContext | null
  /** B13: "Who sees this" badges drawn on the nodes that have rules. */
  audienceBadges?: CanvasAudienceBadge[]
  /**
   * B14: the page context live text and the store page main parts draw with (the toolbar's
   * sample; a normal page: the store's own fields), and the data the main part draws. Undefined =
   * no `page-context` message (documents without live text).
   */
  pageContext?: StorePageContext | null
  pageSample?: StorePageSample | null
  /** B16: numbered comment pins over the page (null: none). */
  pins?: CommentPinLayer | null
  /**
   * B16 comment mode: a click on the page drops a comment there (the point in canvas pixels) instead
   * of selecting; the wheel still scrolls the page. Null: off.
   */
  onCommentAt?: ((point: { x: number; y: number }) => void) | null
  /** B18: the toolbar's "Preview motion" — loops, text effects and animated dividers run on the canvas while on (default off). */
  previewMotion?: boolean
  /**
   * B21 "What next?": drawn in the overlay under the last section (`rect`, canvas px; null = empty
   * page), editor only. `height`: the overlay's height (px). Null / absent: none.
   */
  nextStrip?: ((place: { rect: Rect | null; scale: number; width: number; height: number }) => ReactNode) | null
}

export function CanvasFrame(props: CanvasFrameProps) {
  const { bootstrap, locale, sections, data, media, pending, selection, selectedIds, deviceOrder, hover, errorIds, device, dragging, indicator, onSelect, onHover, onKey, toolbar, hoverLabel, handleRef, theme, resizeRow, onResize, surroundings = 'page', emptyText, popup, product, scrollProgress = null, onEdit, spacing, uploads, fonts, heat, previewAs = null, audienceBadges, arms, pageContext, pageSample = null, pins = null, onCommentAt = null, previewMotion = false, nextStrip = null } = props
  const areaRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [area, setArea] = useState({ w: 0, h: 0 })
  const [ready, setReady] = useState(0)
  // B10: a render the canvas waits for although nothing changed (a refused text edit shows the old text at once).
  const [renderTick, setRenderTick] = useState(0)
  // B10: a file dragged in from the desktop: the overlay lets every pointer through to the canvas.
  const [fileDrag, setFileDrag] = useState(false)
  // B21: where the dragged picture files would land (the canvas's `drag-files`), and how many there are.
  const [fileOver, setFileOver] = useState<{ over: FileDropHover; count?: number } | null>(null)
  const fileDragTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [rects, setRects] = useState<Record<string, Rect>>({})
  const rectsRef = useRef<Record<string, Rect>>({})
  const viewportRef = useRef({ w: DEVICE_WIDTHS.desktop, h: 0 })
  const callbacks = useRef({ onSelect, onHover, onKey, onEdit })
  useLayoutEffect(() => {
    callbacks.current = { onSelect, onHover, onKey, onEdit }
  })
  // B10: the node whose text is being edited in the canvas (its toolbar and handles step aside).
  const [editing, setEditing] = useState<string | null>(null)
  const editingRef = useRef<string | null>(null)

  const width = DEVICE_WIDTHS[device]
  const scale = area.w > 0 ? Math.min(1, (area.w - 32) / width) : 1
  const frameHeight = scale > 0 ? Math.max(200, area.h / scale) : area.h
  // The mini toolbar's real width (it grows with its buttons), for keeping it inside the canvas.
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [toolbarWidth, setToolbarWidth] = useState(280)
  useLayoutEffect(() => {
    const el = toolbarRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setToolbarWidth(Math.ceil(el.offsetWidth) || 280))
    observer.observe(el)
    return () => observer.disconnect()
  })

  useLayoutEffect(() => {
    const el = areaRef.current
    if (!el) return
    const measure = () => setArea({ w: el.clientWidth, h: el.clientHeight })
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const send = useCallback((message: ParentMessage) => {
    frameRef.current?.contentWindow?.postMessage(envelope(message), window.location.origin)
  }, [])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message: CanvasMessage | null = readCanvasMessage(event, window.location.origin, frameRef.current?.contentWindow ?? null)
      if (!message) return
      if (EDIT_TYPES.has(message.type)) {
        const edit = message as CanvasEditMessage
        if (edit.type === 'image-drop' || edit.type === 'drop-files') {
          clearTimeout(fileDragTimer.current)
          setFileDrag(false)
          setFileOver(null)
        }
        if (edit.type === 'text-edit-start') editingRef.current = edit.id
        else if (edit.type === 'text-edit-commit' || edit.type === 'text-edit-cancel') editingRef.current = null
        setEditing(editingRef.current)
        callbacks.current.onEdit?.(edit)
        return
      }
      switch (message.type) {
        case 'ready':
          // A new canvas page has no edit going on.
          editingRef.current = null
          setEditing(null)
          setReady((n) => n + 1)
          break
        case 'rects':
          rectsRef.current = message.nodes
          viewportRef.current = message.viewport
          setRects(message.nodes)
          break
        case 'click':
          // A click on the page takes focus off any field, so Delete and the arrows act on the selection.
          // B10: not the canvas itself — that would end a text edit the canvas has just started (the
          // double-click's second click arrives after the edit took focus).
          if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body && document.activeElement !== frameRef.current) document.activeElement.blur()
          // B19: a click on a story step / gallery card opens that item's card in the inspector.
          revealItem(message.id, message.item)
          callbacks.current.onSelect(message.id, { toggle: message.ctrl === true || message.meta === true, range: message.shift === true })
          break
        case 'hover':
          callbacks.current.onHover(message.id)
          break
        case 'key':
          callbacks.current.onKey(message)
          break
        case 'drag-files':
          // B21: the canvas tells where the files would land (null: nowhere, or they left it).
          setFileOver(message.over ? { over: message.over, ...(message.count !== undefined ? { count: message.count } : {}) } : null)
          break
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // B10: a language change is `set-locale`; init carries the language the canvas starts in.
  const localeRef = useRef(locale)
  const sentLocale = useRef<string | null>(null)
  useEffect(() => {
    if (ready === 0) return
    send({ type: 'init', bootstrap, locale: localeRef.current })
    sentLocale.current = localeRef.current
  }, [ready, bootstrap, send])
  useEffect(() => {
    localeRef.current = locale
    if (ready === 0 || sentLocale.current === locale) return
    send({ type: 'set-locale', locale })
    sentLocale.current = locale
  }, [ready, locale, send])

  // B13: "Preview as" on change and after every `ready` — a new canvas page starts with "Show
  // everything", so that needs no message.
  const sentPreview = useRef<{ ready: number; context: PreviewContext | null }>({ ready: 0, context: null })
  useEffect(() => {
    if (ready === 0) return
    const last = sentPreview.current
    if (last.ready === ready && last.context === previewAs) return
    if (last.ready !== ready && previewAs === null) {
      sentPreview.current = { ready, context: null }
      return
    }
    send({ type: 'preview-as', context: previewAs })
    sentPreview.current = { ready, context: previewAs }
  }, [ready, previewAs, send])

  // B18: "Preview motion" on change and after every `ready` — a new canvas page starts with it off.
  const sentMotion = useRef<{ ready: number; on: boolean }>({ ready: 0, on: false })
  useEffect(() => {
    if (ready === 0) return
    const last = sentMotion.current
    if (last.ready === ready && last.on === previewMotion) return
    sentMotion.current = { ready, on: previewMotion }
    if (last.ready !== ready && !previewMotion) return
    send({ type: 'preview-motion', on: previewMotion })
  }, [ready, previewMotion, send])

  // B14: the page context after every `ready` and on change (before the render that uses it).
  useEffect(() => {
    if (ready === 0 || pageContext === undefined) return
    send({ type: 'page-context', context: pageContext, sample: pageSample })
  }, [ready, pageContext, pageSample, send])

  useEffect(() => {
    if (ready > 0 && theme) send(fonts ? { type: 'theme', settings: theme, fonts } : { type: 'theme', settings: theme })
  }, [ready, theme, fonts, send])

  useEffect(() => {
    if (ready > 0) {
      send({
        type: 'render', sections, data, media, selection, hover, errors: errorIds, device, pending, surroundings,
        ...(emptyText ? { emptyText } : {}),
        ...(popup ? { popup } : {}),
        ...(product ? { product } : {}),
        ...(deviceOrder ? { device_order: deviceOrder } : {}),
        ...(scrollProgress ? { scroll_progress: scrollProgress } : {}),
      })
    }
  }, [ready, sections, data, media, selection, hover, errorIds, device, pending, surroundings, emptyText, popup, product, deviceOrder, scrollProgress, send, renderTick])

  useEffect(() => {
    const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files')
    const timer = fileDragTimer
    const over = (event: DragEvent) => {
      if (!hasFiles(event)) return
      setFileDrag(true)
      // dragover repeats while the file is over this window; when it stops (dropped in the canvas, left), the overlay comes back.
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setFileDrag(false), 1500)
    }
    const end = () => {
      clearTimeout(timer.current)
      setFileDrag(false)
      setFileOver(null)
    }
    window.addEventListener('dragenter', over)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', end)
    window.addEventListener('dragend', end)
    return () => {
      clearTimeout(timer.current)
      window.removeEventListener('dragenter', over)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', end)
      window.removeEventListener('dragend', end)
    }
  }, [])

  useImperativeHandle(
    handleRef,
    () => ({
      scrollTo: (id) => send({ type: 'scroll-to', id }),
      scrollBy: (dy) => send({ type: 'scroll-by', dy }),
      playMotion: (id, scope) => send(scope ? { type: 'play-motion', id, scope } : { type: 'play-motion', id }),
      previewScroll: (id) => send({ type: 'preview-scroll', id }),
      toCanvasPoint: (clientX, clientY) => {
        const frame = frameRef.current
        if (!frame) return null
        const box = frame.getBoundingClientRect()
        if (clientX < box.left || clientX > box.right || clientY < box.top || clientY > box.bottom) return null
        return { x: (clientX - box.left) / scale, y: (clientY - box.top) / scale }
      },
      rects: () => rectsRef.current,
      viewport: () => viewportRef.current,
      editText: (id, field) => {
        // Typing goes into the canvas: it gets the focus before it starts the edit.
        frameRef.current?.focus()
        frameRef.current?.contentWindow?.focus()
        send(field ? { type: 'edit-text', id, field } : { type: 'edit-text', id })
      },
      rerender: () => setRenderTick((n) => n + 1),
      endTextEdit: (commit) => {
        if (editingRef.current !== null) send({ type: 'end-text-edit', commit })
      },
      linkResult: (url) => send({ type: 'text-edit-link-result', url }),
      editing: () => editingRef.current,
    }),
    [scale, send],
  )

  const scaled = (r: Rect) => ({ left: r.x * scale, top: r.y * scale, width: r.w * scale, height: r.h * scale })
  // B12: several selected — the others get outlines here (the canvas outlines the primary) and the toolbar spans them all.
  const others = (selectedIds ?? []).filter((id) => id !== selection)
  const group = others.length > 0 ? unionRect([selection, ...others].map((id) => (id ? rects[id] : undefined))) : undefined
  const selected = group ?? (selection ? rects[selection] : undefined)
  const hovered = hover && hover !== selection && !others.includes(hover) ? rects[hover] : undefined
  const editingNow = editing !== null
  const spacingRect = spacing ? rects[spacing.nodeId] : undefined
  // B21: the lowest drawn section (on a tablet or phone the order may differ from the list).
  const lastSection = nextStrip ? lowestRect(sections.map((s) => rects[s.id])) : undefined

  return (
    <div ref={areaRef} className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-muted/60" data-testid="canvas-area" data-device={device}>
      <div className="relative mx-auto mt-0 h-full" style={{ width: width * scale }}>
        <iframe
          ref={frameRef}
          src={CANVAS_URL}
          title="Page canvas: your page as shoppers will see it"
          data-testid="builder-canvas"
          className="absolute top-0 left-0 border-0 bg-white shadow-sm"
          style={{ width, height: frameHeight, transform: `scale(${scale})`, transformOrigin: '0 0' }}
        />
        <div
          className={dragging ? 'absolute inset-0 z-10 cursor-grabbing' : cn('pointer-events-none absolute inset-0 z-10 overflow-hidden', fileDrag && '[&_*]:pointer-events-none!')}
          data-testid="canvas-overlay"
          data-file-drag={fileDrag || undefined}
          aria-hidden={dragging ? true : undefined}
        >
          {!dragging && heat && <HeatOverlay layer={heat} rects={rects} scale={scale} />}
          {!dragging && audienceBadges && audienceBadges.length > 0 && <AudienceCanvasBadges badges={audienceBadges} rects={rects} scale={scale} hide={editingNow ? editing : null} />}
          {!dragging && !editingNow && arms && <ArmSwitchers layer={arms} rects={rects} scale={scale} height={frameHeight * scale} />}
          {!dragging && hovered && hover && hovered.h > 0 && (
            <span className="absolute rounded-sm bg-blue-600 px-1.5 py-0.5 text-[11px] font-medium text-white" style={{ left: Math.max(0, hovered.x * scale), top: Math.max(0, hovered.y * scale) }}>
              {hoverLabel(hover)}
            </span>
          )}
          {!dragging &&
            others.map((id) => {
              const r = rects[id]
              return r && r.h > 0 ? <div key={id} data-testid="multi-outline" className="absolute rounded-[2px] outline-2 -outline-offset-2 outline-blue-600" style={scaled(r)} /> : null
            })}
          {!dragging && !editingNow && selected && selected.h > 0 && (
            <div ref={toolbarRef} className="pointer-events-auto absolute" style={toolbarPosition(selected, scale, { w: width * scale, h: frameHeight * scale }, toolbarWidth)}>
              {toolbar(selected)}
            </div>
          )}
          {!dragging && !editingNow && resizeRow && onResize && <ColumnHandles row={resizeRow} rects={rects} scale={scale} onResize={onResize} />}
          {!dragging && !editingNow && spacing && spacingRect && (
            <SpacingHandles nodeId={spacing.nodeId} nodeLabel={spacing.label} rect={spacingRect} scale={scale} values={spacing.values} deviceLabel={spacing.deviceLabel} onChange={spacing.onChange} guides={spacing.guides} />
          )}
          {Object.entries(uploads ?? {}).map(([id, upload]) => {
            // B22a: pictures dropped on the empty canvas have no node yet: the visible canvas.
            const r = rects[id] ?? (id === PAGE_DROP_ID ? { x: 0, y: 0, w: width, h: frameHeight } : undefined)
            if (!r || r.h <= 0) return null
            const percent = upload.progress === null ? null : Math.round(upload.progress * 100)
            return (
              <div key={id} className="absolute z-20 flex items-center justify-center bg-black/40" style={scaled(r)} data-testid={`upload-${id}`}>
                <div
                  role="progressbar"
                  aria-label={`Uploading ${upload.name}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percent ?? undefined}
                  className="flex w-48 max-w-[80%] flex-col gap-1 rounded-md bg-white px-3 py-2 text-xs text-neutral-900 shadow"
                >
                  <span className="truncate">Uploading {upload.name}…{percent !== null ? ` ${percent} %` : ''}</span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-neutral-200" aria-hidden>
                    <span className="block h-full bg-blue-600 transition-[width] motion-reduce:transition-none" style={{ width: `${percent ?? 10}%` }} />
                  </span>
                </div>
              </div>
            )
          })}
          {!dragging && pins && pins.pins.length > 0 && <CommentPins layer={pins} rects={rects} scale={scale} />}
          {!dragging && fileOver && <FileDropMark over={fileOver.over} count={fileOver.count} scale={scale} />}
          {!dragging && !editingNow && !fileOver && nextStrip && (sections.length === 0 || lastSection) && nextStrip({ rect: sections.length === 0 ? null : lastSection!, scale, width: width * scale, height: frameHeight * scale })}
          {dragging && indicator && (
            <div
              data-testid="drop-indicator"
              className={indicator.kind === 'line' ? 'absolute h-1 -translate-y-1/2 rounded-full bg-blue-600 shadow' : 'absolute rounded border-2 border-dashed border-blue-600 bg-blue-600/10'}
              style={indicator.kind === 'line' ? { ...scaled(indicator.rect), height: 4 } : scaled(indicator.rect)}
            />
          )}
        </div>
        {onCommentAt && !dragging && (
          <div
            aria-hidden
            data-testid="comment-catcher"
            className="absolute inset-0 z-[5] cursor-crosshair"
            onClick={(event) => {
              const box = event.currentTarget.getBoundingClientRect()
              onCommentAt({ x: (event.clientX - box.left) / scale, y: (event.clientY - box.top) / scale })
            }}
            onWheel={(event) => send({ type: 'scroll-by', dy: event.deltaY / scale })}
          />
        )}
      </div>
    </div>
  )
}

/** B21: where dragged picture files would land — the node's box or the insertion line, with what happens ("Replace picture"). */
function FileDropMark({ over, count, scale }: { over: FileDropHover; count?: number; scale: number }) {
  const label = dropLabel(over, count)
  const r = over.rect
  const line = over.line === true
  return (
    <div data-testid="file-drop-mark" data-kind={over.kind} data-node={over.node_id}>
      <div
        className={line ? 'absolute h-1 -translate-y-1/2 rounded-full bg-emerald-600 shadow' : 'absolute rounded border-2 border-dashed border-emerald-600 bg-emerald-600/10'}
        style={{ left: r.x * scale, top: r.y * scale, width: r.w * scale, height: line ? 4 : r.h * scale }}
      />
      <span
        className="absolute max-w-[90%] truncate rounded-sm bg-emerald-700 px-2 py-0.5 text-xs font-medium text-white shadow"
        style={{ left: Math.max(0, r.x * scale) + 4, top: Math.max(0, r.y * scale + (line ? 6 : 4)) }}
      >
        {label}
      </span>
      <span role="status" className="sr-only">{label}</span>
    </div>
  )
}

/** B21: the drawn rect that ends lowest; undefined when none is drawn. */
function lowestRect(list: (Rect | undefined)[]): Rect | undefined {
  let lowest: Rect | undefined
  for (const r of list) if (r && r.h > 0 && (!lowest || r.y + r.h > lowest.y + lowest.h)) lowest = r
  return lowest
}

/** The box around several rects (the ones drawn); undefined when none is. */
function unionRect(list: (Rect | undefined)[]): Rect | undefined {
  const drawn = list.filter((r): r is Rect => r !== undefined && r.h > 0)
  if (drawn.length === 0) return undefined
  const x = Math.min(...drawn.map((r) => r.x))
  const y = Math.min(...drawn.map((r) => r.y))
  const right = Math.max(...drawn.map((r) => r.x + r.w))
  const bottom = Math.max(...drawn.map((r) => r.y + r.h))
  return { x, y, w: right - x, h: bottom - y }
}
