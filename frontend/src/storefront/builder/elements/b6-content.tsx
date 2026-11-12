import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { BadgePercentIcon, CheckCircle2Icon, ChevronDownIcon, InfoIcon, TriangleAlertIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MenuLink } from '../../components/menu-link'
import { RichText } from '../../components/rich-text'
import { useLocale } from '../../i18n/locale'
import { sanitizeHtml } from '../canvas/sanitize'
import { BuilderIcon, isIconName } from '../icons'
import { motionAllowed } from '../motion'
import { DraftPlaceholder } from '../preview-mark'
import { usePage } from '../render-context'
import { B6_ENUMS, B6_LIMITS, B6_TEXT_LIMITS, hasTwoDecimals, listItems, oneOf, safeLink } from '../validate'
import { str, type El } from './shared'

/*
 * B6 content elements (contract §1 "Content"): accordion, tabs, icon box, icon list, quote,
 * notice, counter, steps and trust badges. Every value is checked again here (the renderer never
 * trusts the payload's shape); rich text is cleaned again with the canvas sanitizer.
 */

function useCleanHtml(html: string): string {
  return useMemo(() => sanitizeHtml(html), [html])
}

/* -------------------------------------------------------------------------------------------- */

type Panel = { id: string; title: string; html: string }

function panels(value: unknown, max: number, limits: { title: number; html: number }): Panel[] {
  return listItems(value, max)
    .map((item) => ({ id: item.id as string, title: str(item.title).slice(0, limits.title).trim(), html: str(item.html).slice(0, limits.html) }))
    .filter((item) => item.title !== '')
}

function PanelBody({ html }: { html: string }) {
  const clean = useCleanHtml(html)
  return clean.trim() ? <RichText html={clean} /> : null
}

/**
 * Questions that open their answer (WAI-ARIA accordion: a heading with a button per item,
 * `aria-expanded` / `aria-controls`). `allow_multiple` false closes the others.
 */
export function AccordionElement({ element }: { element: El<'accordion'> }) {
  const p = element.props ?? {}
  const items = panels(p.items, B6_LIMITS.accordionItems.max, { title: B6_TEXT_LIMITS.accordion['items.*.title'], html: B6_TEXT_LIMITS.accordion['items.*.html'] })
  const allowMultiple = p.allow_multiple === true
  const style = oneOf(p.style, B6_ENUMS.accordionStyle) ?? 'boxed'
  const [open, setOpen] = useState<string[]>(() => (p.open_first !== false && items[0] ? [items[0].id] : []))
  const base = useId()
  if (items.length === 0) return <DraftPlaceholder element={element} />

  const toggle = (id: string) =>
    setOpen((current) => (current.includes(id) ? current.filter((value) => value !== id) : allowMultiple ? [...current, id] : [id]))

  return (
    <div data-b={element.id} className={cn('b-accordion', style === 'boxed' ? 'divide-y rounded-sf-card border bg-sf-surface' : 'divide-y border-y')} data-testid="builder-accordion">
      {items.map((item) => {
        const expanded = open.includes(item.id)
        const buttonId = `${base}-${item.id}-button`
        const panelId = `${base}-${item.id}-panel`
        return (
          <div key={item.id} className={style === 'boxed' ? 'px-5' : undefined}>
            <h3 className="m-0">
              <button
                type="button"
                id={buttonId}
                aria-expanded={expanded}
                aria-controls={panelId}
                onClick={() => toggle(item.id)}
                className="flex min-h-12 w-full items-center justify-between gap-4 py-4 text-left font-semibold text-sf-heading focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent"
              >
                {item.title}
                <ChevronDownIcon aria-hidden className={cn('size-5 shrink-0 transition-transform motion-reduce:transition-none', expanded && 'rotate-180')} />
              </button>
            </h3>
            <div id={panelId} role="region" aria-labelledby={buttonId} hidden={!expanded} className="pb-4">
              <PanelBody html={item.html} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Tabs (WAI-ARIA tabs, automatic activation): arrow keys move between tabs (left / right, or up /
 * down when vertical), Home / End jump to the ends; only the selected tab is in the tab order.
 */
export function TabsElement({ element }: { element: El<'tabs'> }) {
  const p = element.props ?? {}
  const items = panels(p.items, B6_LIMITS.tabsItems.max, { title: B6_TEXT_LIMITS.tabs['items.*.title'], html: B6_TEXT_LIMITS.tabs['items.*.html'] })
  const vertical = oneOf(p.layout, B6_ENUMS.tabsLayout) === 'vertical'
  const [active, setActive] = useState(0)
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const base = useId()
  if (items.length === 0) return <DraftPlaceholder element={element} />
  const current = Math.min(active, items.length - 1)

  const select = (index: number) => {
    const next = (index + items.length) % items.length
    setActive(next)
    tabs.current[next]?.focus()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const keys = vertical ? { prev: 'ArrowUp', next: 'ArrowDown' } : { prev: 'ArrowLeft', next: 'ArrowRight' }
    if (event.key === keys.next) select(current + 1)
    else if (event.key === keys.prev) select(current - 1)
    else if (event.key === 'Home') select(0)
    else if (event.key === 'End') select(items.length - 1)
    else return
    event.preventDefault()
  }

  return (
    <div data-b={element.id} className={cn('b-tabs flex gap-4', vertical ? 'flex-col md:flex-row' : 'flex-col')} data-testid="builder-tabs" data-layout={vertical ? 'vertical' : 'horizontal'}>
      <div
        role="tablist"
        aria-orientation={vertical ? 'vertical' : 'horizontal'}
        onKeyDown={onKeyDown}
        className={cn('flex gap-1', vertical ? 'flex-row flex-wrap md:w-56 md:shrink-0 md:flex-col' : 'flex-wrap border-b')}
      >
        {items.map((item, i) => (
          <button
            key={item.id}
            ref={(node) => {
              tabs.current[i] = node
            }}
            type="button"
            role="tab"
            id={`${base}-${item.id}-tab`}
            aria-selected={i === current}
            aria-controls={`${base}-${item.id}-panel`}
            tabIndex={i === current ? 0 : -1}
            onClick={() => setActive(i)}
            className={cn(
              'min-h-11 px-4 py-2 text-left text-sm font-semibold transition focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sf-accent',
              vertical ? 'rounded-sf-button' : '-mb-px border-b-2',
              i === current ? (vertical ? 'bg-sf-accent text-sf-accent-foreground' : 'border-sf-accent text-sf-heading') : vertical ? 'hover:bg-sf-surface' : 'border-transparent hover:text-sf-heading',
            )}
          >
            {item.title}
          </button>
        ))}
      </div>
      {items.map((item, i) => (
        <div key={item.id} role="tabpanel" id={`${base}-${item.id}-panel`} aria-labelledby={`${base}-${item.id}-tab`} tabIndex={0} hidden={i !== current} className="min-w-0 flex-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent">
          <PanelBody html={item.html} />
        </div>
      ))}
    </div>
  )
}

/* -------------------------------------------------------------------------------------------- */

const ICON_FRAMES = {
  plain: 'text-sf-accent',
  circle: 'grid size-14 place-items-center rounded-full bg-sf-accent text-sf-accent-foreground',
  square: 'grid size-14 place-items-center rounded-sf-card bg-sf-accent text-sf-accent-foreground',
} as const

/** An icon with a title and a line of text; with a link the title carries it. */
export function IconBoxElement({ element }: { element: El<'icon_box'> }) {
  const p = element.props ?? {}
  const title = str(p.title).slice(0, B6_TEXT_LIMITS.icon_box.title).trim()
  const text = str(p.text).slice(0, B6_TEXT_LIMITS.icon_box.text).trim()
  const url = safeLink(p.link)
  const left = oneOf(p.layout, B6_ENUMS.iconBoxLayout) === 'left'
  const frame = oneOf(p.icon_style, B6_ENUMS.iconStyle) ?? 'circle'
  if (!title && !text) return <DraftPlaceholder element={element} />

  return (
    <div data-b={element.id} className={cn('b-icon-box flex gap-4', left ? 'flex-row items-start' : 'flex-col items-center text-center')} data-testid="builder-icon-box">
      {isIconName(p.icon) && (
        <span aria-hidden className={cn('shrink-0', ICON_FRAMES[frame])}>
          <BuilderIcon name={p.icon} size={frame === 'plain' ? 40 : 28} />
        </span>
      )}
      <div className="flex min-w-0 flex-col gap-1.5">
        {title && (
          <h3 className="text-lg font-bold text-sf-heading">
            {url ? (
              <MenuLink url={url} className="hover:text-sf-accent hover:underline">
                {title}
              </MenuLink>
            ) : (
              title
            )}
          </h3>
        )}
        {text && (!title && url ? <MenuLink url={url} className="hover:underline">{text}</MenuLink> : <p className="whitespace-pre-line">{text}</p>)}
      </div>
    </div>
  )
}

/** A list with an icon per line (decorative icons; the text carries the meaning). */
export function IconListElement({ element }: { element: El<'icon_list'> }) {
  const p = element.props ?? {}
  const inline = oneOf(p.layout, B6_ENUMS.iconListLayout) === 'inline'
  const items = listItems(p.items, B6_LIMITS.iconListItems.max)
    .map((item) => ({ id: item.id as string, icon: item.icon, text: str(item.text).slice(0, B6_TEXT_LIMITS.icon_list['items.*.text']).trim(), url: safeLink(item.link) }))
    .filter((item) => item.text !== '')
  if (items.length === 0) return <DraftPlaceholder element={element} />

  return (
    <ul data-b={element.id} className={cn('b-icon-list flex', inline ? 'flex-row flex-wrap gap-x-6 gap-y-2' : 'flex-col gap-2.5')} data-testid="builder-icon-list">
      {items.map((item) => (
        <li key={item.id} className="flex items-start gap-2.5">
          {isIconName(item.icon) && <BuilderIcon name={item.icon} size={20} className="mt-0.5 shrink-0 text-sf-accent" />}
          {item.url ? (
            <MenuLink url={item.url} className="hover:text-sf-accent hover:underline">
              {item.text}
            </MenuLink>
          ) : (
            <span>{item.text}</span>
          )}
        </li>
      ))}
    </ul>
  )
}

/* -------------------------------------------------------------------------------------------- */

/** A quotation with its author (figure / blockquote / figcaption). */
export function QuoteElement({ element }: { element: El<'quote'> }) {
  const p = element.props ?? {}
  const L = B6_TEXT_LIMITS.quote
  const text = str(p.text).slice(0, L.text).trim()
  const author = str(p.author).slice(0, L.author).trim()
  const role = str(p.role).slice(0, L.role).trim()
  const style = oneOf(p.style, B6_ENUMS.quoteStyle) ?? 'card'
  if (!text) return <DraftPlaceholder element={element} />

  return (
    <figure
      data-b={element.id}
      data-style={style}
      className={cn(
        'b-quote relative flex flex-col gap-4',
        style === 'card' && 'rounded-sf-card border bg-sf-surface p-6 lg:p-8',
        style === 'plain' && 'border-l-4 border-sf-accent pl-5',
        style === 'large' && 'items-center px-4 text-center',
      )}
      data-testid="builder-quote"
    >
      {style === 'large' && (
        <span aria-hidden className="font-heading text-6xl leading-none text-sf-accent">
          “
        </span>
      )}
      <blockquote className={cn('whitespace-pre-line', style === 'large' ? 'font-heading text-2xl leading-snug font-bold text-sf-heading lg:text-3xl' : 'text-lg italic')}>
        <p>{text}</p>
      </blockquote>
      {(author || role) && (
        <figcaption className="text-sm">
          {author && <span className="font-bold text-sf-heading">{author}</span>}
          {author && role && <span aria-hidden>, </span>}
          {role && <span>{role}</span>}
        </figcaption>
      )}
    </figure>
  )
}

const NOTICE_TONES = {
  info: { Icon: InfoIcon, label: 'content.builder.notice.info', frame: 'border-sky-600 bg-sky-50 text-neutral-900', accent: 'text-sky-800' },
  success: { Icon: CheckCircle2Icon, label: 'content.builder.notice.success', frame: 'border-emerald-600 bg-emerald-50 text-neutral-900', accent: 'text-emerald-800' },
  warning: { Icon: TriangleAlertIcon, label: 'content.builder.notice.warning', frame: 'border-amber-500 bg-amber-50 text-neutral-900', accent: 'text-amber-900' },
  promo: { Icon: BadgePercentIcon, label: 'content.builder.notice.promo', frame: 'border-sf-sale bg-sf-surface', accent: 'text-sf-sale' },
} as const

/**
 * A highlighted message. Its tone is said in words (a visible label) and with an icon, never by
 * colour alone; the colours keep the text dark on a light tint (AA contrast).
 */
export function NoticeElement({ element }: { element: El<'notice'> }) {
  const { t } = useLocale()
  const p = element.props ?? {}
  const tone = NOTICE_TONES[oneOf(p.tone, B6_ENUMS.noticeTone) ?? 'info']
  const title = str(p.title).slice(0, B6_TEXT_LIMITS.notice.title).trim()
  const text = str(p.text).slice(0, B6_TEXT_LIMITS.notice.text).trim()
  if (!title && !text) return <DraftPlaceholder element={element} />
  const { Icon } = tone

  return (
    <div data-b={element.id} role="note" className={cn('b-notice flex gap-3 rounded-sf-card border-l-4 p-4', tone.frame)} data-testid="builder-notice" data-tone={oneOf(p.tone, B6_ENUMS.noticeTone) ?? 'info'}>
      {p.show_icon !== false && <Icon aria-hidden className={cn('mt-0.5 size-5 shrink-0', tone.accent)} />}
      <div className="flex min-w-0 flex-col gap-1">
        <p className={cn('text-xs font-bold tracking-wide uppercase', tone.accent)}>{t(tone.label)}</p>
        {title && <p className="font-bold">{title}</p>}
        {text && <p className="whitespace-pre-line">{text}</p>}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------------------------- */

type Counter = { id: string; value: number; decimals: number; prefix: string; suffix: string; label: string }

function decimalsOf(value: number): number {
  return Number.isInteger(value) ? 0 : Number.isInteger(value * 10) ? 1 : 2
}

const COUNT_UP_MS = 1600

/**
 * Figures that count up from zero when they scroll into view (once). Screen readers always get
 * the final figure (the moving digits are hidden from them); no animation for reduced motion, in
 * the editor canvas, or without IntersectionObserver — the final figure then shows at once.
 */
export function CounterElement({ element }: { element: El<'counter'> }) {
  const { formatNumber } = useLocale()
  const { page } = usePage()
  const p = element.props ?? {}
  const L = B6_TEXT_LIMITS.counter
  const items: Counter[] = listItems(p.items, B6_LIMITS.counterItems.max)
    .filter((item) => hasTwoDecimals(item.value) && item.value >= 0 && item.value <= B6_LIMITS.counterValue.max)
    .map((item) => ({
      id: item.id as string,
      value: item.value as number,
      decimals: decimalsOf(item.value as number),
      prefix: str(item.prefix).slice(0, L['items.*.prefix']),
      suffix: str(item.suffix).slice(0, L['items.*.suffix']),
      label: str(item.label).slice(0, L['items.*.label']),
    }))
  const animate = p.animate !== false && page.document?.key !== 'canvas'
  const rootRef = useRef<HTMLUListElement>(null)
  // 1 = the final figures (also the state without JS effects); 0…1 while counting.
  const [progress, setProgress] = useState(1)

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!animate || !root || typeof IntersectionObserver === 'undefined' || !motionAllowed()) return
    setProgress(0)
    let frame = 0
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        observer.disconnect()
        const start = performance.now()
        const step = (now: number) => {
          const t = Math.min(1, (now - start) / COUNT_UP_MS)
          setProgress(1 - (1 - t) ** 3)
          if (t < 1) frame = requestAnimationFrame(step)
        }
        frame = requestAnimationFrame(step)
      },
      { threshold: 0.3 },
    )
    observer.observe(root)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      setProgress(1)
    }
  }, [animate])

  if (items.length === 0) return <DraftPlaceholder element={element} />
  const format = (value: number, decimals: number) => formatNumber(value, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })

  return (
    <ul ref={rootRef} data-b={element.id} className="b-counter grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-6 text-center" data-testid="builder-counter">
      {items.map((item) => {
        const final = `${item.prefix}${format(item.value, item.decimals)}${item.suffix}`
        const shown = progress >= 1 ? final : `${item.prefix}${format(item.value * progress, item.decimals)}${item.suffix}`
        return (
          <li key={item.id} className="flex flex-col items-center gap-1">
            <p className="font-heading text-4xl font-extrabold text-sf-heading tabular-nums lg:text-5xl">
              <span className="sr-only">{final}</span>
              <span aria-hidden data-counter-value={final}>
                {shown}
              </span>
            </p>
            {item.label && <p className="text-sm font-medium">{item.label}</p>}
          </li>
        )
      })}
    </ul>
  )
}

/* -------------------------------------------------------------------------------------------- */

/** How it works: an ordered list of steps (numbers or icons drawn, the list itself carries the order). */
export function StepsElement({ element }: { element: El<'steps'> }) {
  const { formatNumber } = useLocale()
  const p = element.props ?? {}
  const L = B6_TEXT_LIMITS.steps
  const horizontal = oneOf(p.layout, B6_ENUMS.stepsLayout) !== 'vertical'
  const numbered = p.numbered !== false
  const items = listItems(p.items, B6_LIMITS.stepsItems.max)
    .map((item) => ({ id: item.id as string, title: str(item.title).slice(0, L['items.*.title']).trim(), text: str(item.text).slice(0, L['items.*.text']).trim(), icon: item.icon }))
    .filter((item) => item.title !== '')
  if (items.length === 0) return <DraftPlaceholder element={element} />

  return (
    <ol
      data-b={element.id}
      className={cn('b-steps grid gap-6', horizontal ? 'sm:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))]' : 'grid-cols-1')}
      data-layout={horizontal ? 'horizontal' : 'vertical'}
      data-testid="builder-steps"
    >
      {items.map((item, i) => (
        <li key={item.id} className={cn('flex gap-4', horizontal ? 'flex-col items-center text-center' : 'items-start')}>
          {(numbered || isIconName(item.icon)) && (
            <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-full bg-sf-accent font-heading text-lg font-extrabold text-sf-accent-foreground">
              {numbered ? formatNumber(i + 1) : isIconName(item.icon) ? <BuilderIcon name={item.icon} size={24} /> : null}
            </span>
          )}
          <div className="flex min-w-0 flex-col gap-1">
            <h3 className="text-lg font-bold text-sf-heading">{item.title}</h3>
            {item.text && <p className="whitespace-pre-line">{item.text}</p>}
          </div>
        </li>
      ))}
    </ol>
  )
}

/** Reasons to trust the store (delivery, payment, returns …), in a row or a grid. */
export function TrustBadgesElement({ element }: { element: El<'trust_badges'> }) {
  const p = element.props ?? {}
  const L = B6_TEXT_LIMITS.trust_badges
  const grid = oneOf(p.style, B6_ENUMS.trustBadgesStyle) === 'grid'
  const items = listItems(p.items, B6_LIMITS.trustBadges.max)
    .map((item) => ({ id: item.id as string, icon: item.icon, title: str(item.title).slice(0, L['items.*.title']).trim(), text: str(item.text).slice(0, L['items.*.text']).trim() }))
    .filter((item) => item.title !== '')
  if (items.length === 0) return <DraftPlaceholder element={element} />

  return (
    <ul
      data-b={element.id}
      className={cn('b-trust-badges', grid ? 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3' : 'flex flex-wrap justify-center gap-x-8 gap-y-4')}
      data-style={grid ? 'grid' : 'row'}
      data-testid="builder-trust-badges"
    >
      {items.map((item) => (
        <li key={item.id} className={cn('flex items-center gap-3', grid && 'rounded-sf-card border bg-sf-surface p-4')}>
          {isIconName(item.icon) && <BuilderIcon name={item.icon} size={28} className="shrink-0 text-sf-accent" />}
          <div className="flex flex-col">
            <span className="font-bold text-sf-heading">{item.title}</span>
            {item.text && <span className="text-sm">{item.text}</span>}
          </div>
        </li>
      ))}
    </ul>
  )
}
