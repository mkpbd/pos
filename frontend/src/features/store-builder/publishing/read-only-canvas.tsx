import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent, type Ref } from 'react'
import { envelope, readCanvasMessage, type CanvasSurroundings, type ParentMessage } from '@/storefront/builder/canvas/protocol'
import type { CanvasThemeSettings } from '@/storefront/builder/canvas/theme-override'
import type { Device } from '@/storefront/builder/types'
import type { FontSource } from '@/storefront/fonts'
import type { StorefrontBootstrap } from '@/storefront/types'
import { CANVAS_URL, DEVICE_WIDTHS } from '../canvas-config'
import type { RenderPayload } from '../publishing-api'

/*
 * B11: a canvas that only shows a page (compare and review): the same canvas page and protocol as
 * the editor, with no editing. The iframe is inert; a layer over it catches every pointer, turns
 * the wheel into `scroll-by` (so two canvases can scroll together) and gives keyboard users a
 * focusable, labelled area that scrolls with the arrow keys, Page Up / Page Down and Space.
 * `highlight` outlines one node (the canvas's selection outline) and scrolls it into view.
 */

export type ReadOnlyCanvasHandle = {
  scrollBy: (dy: number) => void
  scrollTo: (id: string) => void
}

type Props = {
  /** The accessible name, e.g. "Live version". */
  label: string
  bootstrap: StorefrontBootstrap
  payload: RenderPayload
  device: Device
  surroundings?: CanvasSurroundings
  emptyText?: string
  /** A node outlined (and scrolled to) on this canvas. */
  highlight?: string | null
  theme?: CanvasThemeSettings | null
  fonts?: FontSource[]
  /** The wheel or a scroll key moved this canvas by dy canvas pixels (to scroll its partner too). */
  onScroll?: (dy: number) => void
  handleRef?: Ref<ReadOnlyCanvasHandle>
  locale?: string
}

/** The canvas clamps one `scroll-by` to ±200 px: longer moves go in steps. */
function steps(dy: number): number[] {
  const out: number[] = []
  let left = dy
  while (Math.abs(left) > 0.5 && out.length < 40) {
    const step = Math.max(-200, Math.min(200, left))
    out.push(step)
    left -= step
  }
  return out
}

export function ReadOnlyCanvas({ label, bootstrap, payload, device, surroundings = 'page', emptyText, highlight = null, theme, fonts, onScroll, handleRef, locale = 'en' }: Props) {
  const areaRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [area, setArea] = useState({ w: 0, h: 0 })
  const [ready, setReady] = useState(0)

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

  const width = DEVICE_WIDTHS[device]
  const scale = area.w > 0 ? Math.min(1, (area.w - 16) / width) : 1
  const frameHeight = scale > 0 ? Math.max(200, area.h / scale) : area.h

  const send = useCallback((message: ParentMessage) => {
    frameRef.current?.contentWindow?.postMessage(envelope(message), window.location.origin)
  }, [])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message = readCanvasMessage(event, window.location.origin, frameRef.current?.contentWindow ?? null)
      if (message?.type === 'ready') setReady((n) => n + 1)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  useEffect(() => {
    if (ready > 0) send({ type: 'init', bootstrap, locale })
  }, [ready, bootstrap, locale, send])
  useEffect(() => {
    if (ready > 0 && theme) send(fonts ? { type: 'theme', settings: theme, fonts } : { type: 'theme', settings: theme })
  }, [ready, theme, fonts, send])
  useEffect(() => {
    if (ready === 0) return
    send({
      type: 'render', sections: payload.sections, data: payload.data, media: payload.media, selection: highlight, hover: null, errors: [], device, pending: [], surroundings,
      ...(emptyText ? { emptyText } : {}),
      ...(payload.popup ? { popup: payload.popup } : {}),
    })
  }, [ready, payload, highlight, device, surroundings, emptyText, send])
  useEffect(() => {
    if (ready > 0 && highlight) send({ type: 'scroll-to', id: highlight })
  }, [ready, highlight, send])

  const scrollBy = useCallback((dy: number) => steps(dy).forEach((step) => send({ type: 'scroll-by', dy: step })), [send])
  useImperativeHandle(handleRef, () => ({ scrollBy, scrollTo: (id: string) => send({ type: 'scroll-to', id }) }), [scrollBy, send])

  const move = (dy: number) => {
    scrollBy(dy)
    onScroll?.(dy)
  }

  const scaleRef = useRef(scale)
  useLayoutEffect(() => {
    scaleRef.current = scale
  })
  // A native listener: React's wheel listener is passive, so it could not stop the page scrolling.
  const moveRef = useRef(move)
  useLayoutEffect(() => {
    moveRef.current = move
  })
  const overlayRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = overlayRef.current
    if (!el) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const unit = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? el.clientHeight : 1
      moveRef.current((event.deltaY * unit) / (scaleRef.current || 1))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const page = frameHeight * 0.85
    const by: Record<string, number> = { ArrowDown: 60, ArrowUp: -60, PageDown: page, PageUp: -page, ' ': event.shiftKey ? -page : page, End: 100_000, Home: -100_000 }
    const dy = by[event.key]
    if (dy === undefined) return
    event.preventDefault()
    move(Math.abs(dy) >= 100_000 ? Math.sign(dy) * 8000 : dy)
  }

  return (
    <div ref={areaRef} className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-muted/60" data-testid="readonly-canvas-area">
      <div className="relative mx-auto h-full" style={{ width: width * scale }}>
        <iframe
          ref={frameRef}
          src={CANVAS_URL}
          title={`${label}: read-only preview`}
          inert
          tabIndex={-1}
          className="absolute top-0 left-0 border-0 bg-white shadow-sm"
          style={{ width, height: frameHeight, transform: `scale(${scale})`, transformOrigin: '0 0' }}
        />
        <div
          ref={overlayRef}
          tabIndex={0}
          role="group"
          aria-roledescription="read-only preview"
          aria-label={`${label}. Scroll with the arrow keys or Page Up and Page Down.`}
          onKeyDown={onKeyDown}
          className="absolute inset-0 z-10 cursor-default outline-none focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:ring-inset"
        />
      </div>
    </div>
  )
}
