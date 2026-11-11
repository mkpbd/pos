import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react'
import { envelope, readCanvasMessage, type CanvasMessage, type ParentMessage, type Rect } from '@/storefront/builder/canvas/protocol'
import type { BuilderMedia, Device, RenderSection } from '@/storefront/builder/types'
import type { StoreSection, StorefrontBootstrap } from '@/storefront/types'
import { CANVAS_URL, DEVICE_WIDTHS } from './canvas-config'
import type { DropIndicator } from './drop-targets'

/*
 * The canvas iframe (/admin/builder-canvas) at the device width, scaled to fit, with the editor's
 * overlay on top: hover label, the selected node's mini toolbar and, while dragging, a layer that
 * catches the pointer (the iframe would swallow it) and draws the drop indicator.
 */


export type CanvasHandle = {
  scrollTo: (id: string) => void
  scrollBy: (dy: number) => void
  /** A client (parent window) point in canvas viewport pixels; null outside the canvas. */
  toCanvasPoint: (clientX: number, clientY: number) => { x: number; y: number } | null
  rects: () => Record<string, Rect>
  viewport: () => { w: number; h: number }
}

export type CanvasFrameProps = {
  bootstrap: StorefrontBootstrap
  locale: string
  sections: RenderSection[]
  data: Record<string, StoreSection>
  media: Record<string, BuilderMedia>
  pending: string[]
  selection: string | null
  hover: string | null
  errorIds: string[]
  device: Device
  dragging: boolean
  indicator: DropIndicator | null
  onSelect: (id: string | null) => void
  onHover: (id: string | null) => void
  onKey: (key: { key: string; ctrl: boolean; shift: boolean; meta: boolean }) => void
  /** The selected node's floating toolbar, placed above its rect. */
  toolbar: (rect: Rect) => ReactNode
  hoverLabel: (id: string) => string
  handleRef: Ref<CanvasHandle>
}

export function CanvasFrame(props: CanvasFrameProps) {
  const { bootstrap, locale, sections, data, media, pending, selection, hover, errorIds, device, dragging, indicator, onSelect, onHover, onKey, toolbar, hoverLabel, handleRef } = props
  const areaRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [area, setArea] = useState({ w: 0, h: 0 })
  const [ready, setReady] = useState(0)
  const [rects, setRects] = useState<Record<string, Rect>>({})
  const rectsRef = useRef<Record<string, Rect>>({})
  const viewportRef = useRef({ w: DEVICE_WIDTHS.desktop, h: 0 })
  const callbacks = useRef({ onSelect, onHover, onKey })
  useLayoutEffect(() => {
    callbacks.current = { onSelect, onHover, onKey }
  })

  const width = DEVICE_WIDTHS[device]
  const scale = area.w > 0 ? Math.min(1, (area.w - 32) / width) : 1
  const frameHeight = scale > 0 ? Math.max(200, area.h / scale) : area.h

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
      switch (message.type) {
        case 'ready':
          setReady((n) => n + 1)
          break
        case 'rects':
          rectsRef.current = message.nodes
          viewportRef.current = message.viewport
          setRects(message.nodes)
          break
        case 'click':
          // A click on the page takes focus off any field, so Delete and the arrows act on the selection.
          if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) document.activeElement.blur()
          callbacks.current.onSelect(message.id)
          break
        case 'hover':
          callbacks.current.onHover(message.id)
          break
        case 'key':
          callbacks.current.onKey(message)
          break
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  useEffect(() => {
    if (ready > 0) send({ type: 'init', bootstrap, locale })
  }, [ready, bootstrap, locale, send])

  useEffect(() => {
    if (ready > 0) send({ type: 'render', sections, data, media, selection, hover, errors: errorIds, device, pending })
  }, [ready, sections, data, media, selection, hover, errorIds, device, pending, send])

  useImperativeHandle(
    handleRef,
    () => ({
      scrollTo: (id) => send({ type: 'scroll-to', id }),
      scrollBy: (dy) => send({ type: 'scroll-by', dy }),
      toCanvasPoint: (clientX, clientY) => {
        const frame = frameRef.current
        if (!frame) return null
        const box = frame.getBoundingClientRect()
        if (clientX < box.left || clientX > box.right || clientY < box.top || clientY > box.bottom) return null
        return { x: (clientX - box.left) / scale, y: (clientY - box.top) / scale }
      },
      rects: () => rectsRef.current,
      viewport: () => viewportRef.current,
    }),
    [scale, send],
  )

  const scaled = (r: Rect) => ({ left: r.x * scale, top: r.y * scale, width: r.w * scale, height: r.h * scale })
  const selected = selection ? rects[selection] : undefined
  const hovered = hover && hover !== selection ? rects[hover] : undefined

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
          className={dragging ? 'absolute inset-0 z-10 cursor-grabbing' : 'pointer-events-none absolute inset-0 z-10 overflow-hidden'}
          data-testid="canvas-overlay"
          aria-hidden={dragging ? true : undefined}
        >
          {!dragging && hovered && hover && hovered.h > 0 && (
            <span className="absolute rounded-sm bg-blue-600 px-1.5 py-0.5 text-[11px] font-medium text-white" style={{ left: Math.max(0, hovered.x * scale), top: Math.max(0, hovered.y * scale) }}>
              {hoverLabel(hover)}
            </span>
          )}
          {!dragging && selected && selected.h > 0 && (
            <div className="pointer-events-auto absolute" style={{ left: Math.max(0, Math.min(selected.x * scale, width * scale - 280)), top: selected.y * scale >= 36 ? selected.y * scale - 34 : Math.max(0, selected.y * scale + 2) }}>
              {toolbar(selected)}
            </div>
          )}
          {dragging && indicator && (
            <div
              data-testid="drop-indicator"
              className={indicator.kind === 'line' ? 'absolute h-1 -translate-y-1/2 rounded-full bg-blue-600 shadow' : 'absolute rounded border-2 border-dashed border-blue-600 bg-blue-600/10'}
              style={indicator.kind === 'line' ? { ...scaled(indicator.rect), height: 4 } : scaled(indicator.rect)}
            />
          )}
        </div>
      </div>
    </div>
  )
}
