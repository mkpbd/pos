import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { XIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLocale } from '../../i18n/locale'
import { PageRenderer } from '../page-renderer'
import type { BuilderPage, StorePopupSettings } from '../types'
import { PopupActionsCtx, type PopupActions } from './popup-context'
import { isModalLayout, popupScope } from './rules'

/*
 * B8b: a popup drawn in its layout (contract §1).
 * - modal / fullscreen: role="dialog" aria-modal="true", named by the admin label or the first
 *   heading; focus moves in, stays in (Tab wraps) and returns on close; Esc closes; the overlay
 *   closes it when allowed; the page behind does not scroll.
 * - slide_in: a non-modal dialog that leaves focus where it is and is announced politely.
 * - bar_top / bar_bottom: a named region fixed to its edge; the page is padded so it covers nothing.
 * Every layout has a close button. `mode: 'canvas'` (the editor) draws the same frame without any
 * of the behaviour (no portal, focus, scroll lock or padding).
 */

export type PopupCloseReason = 'close' | 'overlay' | 'escape' | 'dismiss' | 'link'

const WIDTHS = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-3xl' } as const

const FOCUSABLE = 'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.closest('[aria-hidden="true"]') && !el.hasAttribute('inert'))
}

/** The first heading with text inside the popup's content. */
function firstHeading(root: HTMLElement | null): HTMLElement | null {
  return Array.from(root?.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6') ?? []).find((h) => h.textContent?.trim()) ?? null
}

/**
 * Names the popup (on the DOM, after its content rendered): the admin label, else its first
 * heading (aria-labelledby), else a generic name.
 */
function useAccessibleName(panelRef: React.RefObject<HTMLElement | null>, contentRef: React.RefObject<HTMLElement | null>, id: string, label: string, fallback: string, content: unknown) {
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const heading = label.trim() ? null : firstHeading(contentRef.current)
    if (heading) {
      if (!heading.id) heading.id = `${popupScope(id)}-title`
      panel.setAttribute('aria-labelledby', heading.id)
      panel.removeAttribute('aria-label')
    } else {
      panel.setAttribute('aria-label', label.trim() || fallback)
      panel.removeAttribute('aria-labelledby')
    }
  }, [panelRef, contentRef, id, label, fallback, content])
}

/** Pads the page by a bar's height (top or bottom), so the bar covers nothing; restores it afterwards. */
function useBarPadding(ref: React.RefObject<HTMLElement | null>, edge: 'top' | 'bottom' | null) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!edge || !el) return
    const body = document.body
    const root = document.documentElement
    const property = edge === 'top' ? 'paddingTop' : 'paddingBottom'
    const variable = `--sf-popup-bar-${edge}`
    const before = body.style[property]
    const apply = () => {
      const height = Math.ceil(el.getBoundingClientRect().height)
      body.style[property] = `${height}px`
      root.style.setProperty(variable, `${height}px`)
    }
    apply()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(apply)
    observer?.observe(el)
    return () => {
      observer?.disconnect()
      body.style[property] = before
      root.style.removeProperty(variable)
    }
  }, [ref, edge])
}

/** Locks the page's scroll while a modal-like popup is open. */
function useScrollLock(active: boolean) {
  useLayoutEffect(() => {
    if (!active) return
    const body = document.body
    const before = body.style.overflow
    body.style.overflow = 'hidden'
    return () => {
      body.style.overflow = before
    }
  }, [active])
}

type Props = {
  id: string
  settings: StorePopupSettings
  page: BuilderPage
  mode?: 'live' | 'canvas'
  /** Live only. */
  onClose?: (reason: PopupCloseReason) => void
  onActed?: () => void
}

export function PopupFrame({ id, settings, page, mode = 'live', onClose, onActed }: Props) {
  const { t } = useLocale()
  const live = mode === 'live'
  const layout = settings.layout
  const modal = isModalLayout(layout)
  const bar = layout === 'bar_top' || layout === 'bar_bottom'
  const panelRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  useAccessibleName(panelRef, contentRef, id, settings.label ?? '', bar ? t('promo.popup.bar') : t('promo.popup.specialOffer'), page)
  const [announce, setAnnounce] = useState('')

  const close = useCallback((reason: PopupCloseReason) => onClose?.(reason), [onClose])
  const actions = useMemo<PopupActions | null>(
    () =>
      live
        ? {
            dismiss: () => {
              onActed?.()
              close('dismiss')
            },
            acted: () => onActed?.(),
          }
        : null,
    [live, onActed, close],
  )

  useScrollLock(live && modal)
  useBarPadding(panelRef, live && bar ? (layout === 'bar_top' ? 'top' : 'bottom') : null)

  // Modal: focus moves in on open and returns on close.
  useEffect(() => {
    if (!live || !modal) return
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panelRef.current?.focus({ preventScroll: true })
    return () => {
      const target = returnFocus.current
      if (target?.isConnected && target !== document.body) target.focus({ preventScroll: true })
      else document.getElementById('main')?.focus({ preventScroll: true })
    }
  }, [live, modal])

  // Esc closes a modal-like popup (and a slide-in while focus is inside it).
  useEffect(() => {
    if (!live) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (!modal && !(panelRef.current?.contains(document.activeElement) ?? false)) return
      event.preventDefault()
      close('escape')
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [live, modal, close])

  // Slide-ins announce themselves politely (the live region exists before its text changes).
  useEffect(() => {
    if (!live || layout !== 'slide_in') return
    const timer = window.setTimeout(() => setAnnounce(settings.label.trim() || firstHeading(contentRef.current)?.textContent?.trim() || t('promo.popup.specialOffer')), 50)
    return () => window.clearTimeout(timer)
  }, [live, layout, settings.label, t])

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!live || !modal || event.key !== 'Tab' || !panelRef.current) return
    const items = focusables(panelRef.current)
    if (items.length === 0) {
      event.preventDefault()
      panelRef.current.focus()
      return
    }
    const first = items[0]!
    const last = items[items.length - 1]!
    const active = document.activeElement
    if (event.shiftKey && (active === first || active === panelRef.current)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  // A followed link counts as the visitor's action and closes the popup (the page changes under it).
  const onClickCapture = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!live) return
    const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
    // A link opening a new tab (a form's terms) leaves the popup where it is.
    if (!anchor || !panelRef.current?.contains(anchor) || anchor.getAttribute('target') === '_blank') return
    onActed?.()
    close('link')
  }

  const closeButton = (
    <button
      type="button"
      onClick={() => close('close')}
      aria-label={t('promo.popup.close')}
      data-testid="popup-close"
      className={cn(
        'grid size-11 shrink-0 place-items-center rounded-full text-current transition hover:bg-black/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current',
        !bar && 'absolute top-2 right-2 z-10 bg-sf-surface/90 text-sf-heading shadow',
      )}
    >
      <XIcon aria-hidden className="size-5" />
    </button>
  )

  const content = (
    <div ref={contentRef} className="min-w-0 flex-1">
      <PopupActionsCtx.Provider value={actions}>
        <PageRenderer page={page} scope={popupScope(id)} testId="builder-popup-content" className="b-popup-content" />
      </PopupActionsCtx.Provider>
    </div>
  )

  const common = {
    ref: panelRef,
    'data-testid': 'builder-popup',
    'data-popup-id': id,
    'data-layout': layout,
    onClickCapture,
  }

  let node: ReactNode
  if (bar) {
    node = (
      <div
        {...common}
        role="region"
        className={cn(
          'b-popup b-popup-bar inset-x-0 z-[45] flex items-center gap-2 bg-sf-surface px-2 shadow-md',
          live ? 'fixed' : 'absolute',
          layout === 'bar_top' ? 'top-0 border-b border-sf-border' : 'bottom-0 border-t border-sf-border',
          live && 'animate-in fade-in-0 duration-300 motion-reduce:animate-none',
          live && (layout === 'bar_top' ? 'slide-in-from-top-2' : 'slide-in-from-bottom-2'),
        )}
      >
        {content}
        {closeButton}
      </div>
    )
  } else if (layout === 'slide_in') {
    node = (
      <>
        <div
          {...common}
          role="dialog"
          aria-modal="false"
          className={cn(
            'b-popup b-popup-slide bottom-4 z-50 w-[calc(100%-2rem)] rounded-sf-card bg-sf-surface shadow-xl',
            live && 'max-h-[80dvh] overflow-y-auto',
            live ? 'fixed' : 'absolute',
            WIDTHS[settings.width] ?? WIDTHS.md,
            settings.position === 'bottom_left' ? 'left-4' : 'right-4',
            live && 'animate-in fade-in-0 slide-in-from-bottom-4 duration-300 motion-reduce:animate-none',
          )}
        >
          {content}
          {closeButton}
        </div>
        {live && (
          <div role="status" aria-live="polite" className="sr-only" data-testid="popup-announcer">
            {announce}
          </div>
        )}
      </>
    )
  } else {
    const fullscreen = layout === 'fullscreen'
    const dimmed = settings.overlay
    node = (
      <div className={cn('b-popup-layer inset-0 z-[60] flex justify-center', live ? 'fixed items-center' : 'absolute items-start', !fullscreen && (live ? 'p-4' : 'px-4 py-12'))} data-testid="popup-layer">
        <div
          aria-hidden="true"
          data-testid="popup-overlay"
          onClick={live && settings.close_on_overlay ? () => close('overlay') : undefined}
          className={cn('absolute inset-0', dimmed ? 'bg-black/55' : 'bg-transparent', live && 'animate-in fade-in-0 duration-200 motion-reduce:animate-none')}
        />
        <div
          {...common}
          role="dialog"
          aria-modal={live ? 'true' : 'false'}
          tabIndex={-1}
          onKeyDown={onKeyDown}
          className={cn(
            'b-popup relative outline-none', live && 'overflow-y-auto',
            fullscreen
              ? // Fullscreen always covers the page with the store's surface (text stays readable); `overlay` only dims behind it while it enters.
                'flex h-full w-full items-center bg-sf-surface'
              : cn('w-full rounded-sf-card bg-sf-surface shadow-xl', live && 'max-h-[90dvh]', WIDTHS[settings.width] ?? WIDTHS.md),
            live && 'animate-in fade-in-0 zoom-in-95 duration-200 motion-reduce:animate-none',
          )}
        >
          {fullscreen ? <div className="mx-auto w-full max-w-5xl">{content}</div> : content}
          {closeButton}
        </div>
      </div>
    )
  }

  return live ? createPortal(node, document.body) : node
}
