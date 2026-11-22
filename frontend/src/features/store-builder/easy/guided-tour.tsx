import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import { useEaseUi } from './ease-context'
import { placeCard, TOUR_STEPS, TOUR_WORDS } from './tour-steps'

/*
 * B21 guided tour: a spotlight over one part of the editor at a time (the rest dimmed and not
 * clickable) with a small dialog: step n of 6, a title, one sentence, Back / Next / Skip. Esc
 * closes it; focus moves into the step (its title) and goes back where it was when the tour ends.
 * Under "reduce motion" the spotlight jumps instead of gliding. A step whose part isn't on the
 * screen (e.g. no Motion menu) shows its card in the middle.
 */

type Rect = { top: number; left: number; width: number; height: number }

const PAD = 6
const CARD = { width: 320, height: 200 }
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'

function reducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function measure(target: string): Rect | null {
  const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`)
  if (!el) return null
  const box = el.getBoundingClientRect()
  if (box.width === 0 && box.height === 0) return null
  return { top: box.top - PAD, left: box.left - PAD, width: box.width + PAD * 2, height: box.height + PAD * 2 }
}

/** Where focus goes back to: what had it before, else the toolbar's More menu (a menu item that started the tour is gone). */
function returnTarget(previous: Element | null): HTMLElement | null {
  if (previous instanceof HTMLElement && previous.isConnected && previous !== document.body && !previous.closest('[role="menu"]')) return previous
  return document.querySelector<HTMLElement>('[aria-label="More page actions"]')
}

export function GuidedTour({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null
  return <TourOverlay onClose={onClose} />
}

function TourOverlay({ onClose }: { onClose: () => void }) {
  const { lang, bangla } = useEaseUi()
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const [card, setCard] = useState(CARD)
  const [view, setView] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }))
  const cardRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const ids = useId()
  const step = TOUR_STEPS[index]!
  const last = index === TOUR_STEPS.length - 1
  const words = TOUR_WORDS[lang]
  const text = step[lang]
  // English texts get a Bangla line for stores that sell in Bangla.
  const subtitle = lang === 'en' && bangla ? step.bn : null
  const smooth = !reducedMotion()

  // Focus goes back where it was when the tour ends (a remount in development's strict mode cancels the pending return).
  const opener = useRef<Element | null>(null)
  const pendingReturn = useRef<number | null>(null)
  useLayoutEffect(() => {
    if (pendingReturn.current !== null) {
      cancelAnimationFrame(pendingReturn.current)
      pendingReturn.current = null
    } else opener.current = document.activeElement
    return () => {
      const back = returnTarget(opener.current)
      pendingReturn.current = requestAnimationFrame(() => {
        pendingReturn.current = null
        back?.focus()
      })
    }
  }, [])

  // The spotlight follows its part of the editor (scrolled into view; window resizes; the part's own size).
  useLayoutEffect(() => {
    const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`)
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: smooth ? 'smooth' : 'auto' })
    const update = () => {
      setRect(measure(step.target))
      setView({ width: window.innerWidth, height: window.innerHeight })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    const observer = typeof ResizeObserver === 'function' && el ? new ResizeObserver(update) : null
    if (el) observer?.observe(el)
    // A smooth scroll ends a moment later.
    const settle = setTimeout(update, 350)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      observer?.disconnect()
      clearTimeout(settle)
    }
  }, [step.target, smooth])

  // The card's real size (texts differ per step and language).
  useLayoutEffect(() => {
    const box = cardRef.current?.getBoundingClientRect()
    if (box && box.width > 0 && (Math.round(box.width) !== card.width || Math.round(box.height) !== card.height)) setCard({ width: Math.round(box.width), height: Math.round(box.height) })
  }, [index, lang, card.width, card.height])

  // Each step's title gets the focus (read out by screen readers).
  useEffect(() => {
    titleRef.current?.focus()
  }, [index])

  // Esc closes the tour wherever the focus is.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  // Tab stays inside the step card.
  const trap = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab' || !cardRef.current) return
    const items = [...cardRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
    if (items.length === 0) return
    const first = items[0]!
    const lastItem = items[items.length - 1]!
    const active = document.activeElement
    if (event.shiftKey && (active === first || active === titleRef.current)) {
      event.preventDefault()
      lastItem.focus()
    } else if (!event.shiftKey && active === lastItem) {
      event.preventDefault()
      first.focus()
    }
  }

  const position = placeCard(rect, card, view)
  const glide = smooth ? 'transition-all duration-300 ease-out' : ''

  return (
    <div className="fixed inset-0 z-[60]" data-testid="guided-tour" data-step={step.target}>
      {/* The editor underneath can't be clicked while the tour is open. */}
      <div aria-hidden className="absolute inset-0" />
      {rect ? (
        <div
          aria-hidden
          data-testid="tour-spotlight"
          className={`pointer-events-none absolute rounded-lg ring-2 ring-primary ${glide}`}
          style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height, boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.55)' }}
        />
      ) : (
        <div aria-hidden className="absolute inset-0 bg-black/55" />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={words.label}
        aria-describedby={`${ids}-body`}
        onKeyDown={trap}
        data-testid="tour-card"
        className={`absolute w-80 max-w-[calc(100vw-2rem)] rounded-lg border bg-background p-4 text-foreground shadow-xl ${glide}`}
        style={{ top: position.top, left: position.left }}
        lang={lang}
      >
        <p className="text-xs font-medium text-muted-foreground" data-testid="tour-progress">
          {words.step(index + 1, TOUR_STEPS.length)}
        </p>
        <h2 ref={titleRef} tabIndex={-1} id={`${ids}-title`} className="mt-1 text-base font-semibold outline-none">
          {text.title}
        </h2>
        <p id={`${ids}-body`} className="mt-1 text-sm">
          {text.body}
          {subtitle && (
            <span lang="bn" className="mt-1 block text-xs text-muted-foreground">
              {subtitle.title} — {subtitle.body}
            </span>
          )}
        </p>
        <div className="mt-4 flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            {words.skip}
          </Button>
          <span className="flex-1" />
          {index > 0 && (
            <Button type="button" variant="outline" size="sm" onClick={() => setIndex(index - 1)}>
              {words.back}
            </Button>
          )}
          <Button type="button" size="sm" onClick={() => (last ? onClose() : setIndex(index + 1))}>
            {last ? words.done : words.next}
          </Button>
        </div>
      </div>
    </div>
  )
}
