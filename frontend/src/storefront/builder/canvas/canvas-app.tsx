import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { BootstrapContext, storefrontKeys } from '../../api'
import { NoticeProvider } from '../../components/notice-provider'
import { useDictionary } from '../../i18n/dictionaries'
import { buildLocaleValue, LocaleContext } from '../../i18n/locale'
import { parseLocale, setLocaleRuntime, type Locale } from '../../i18n/runtime'
import { applyCssVars, applyDataAttributes, themeDataAttributes, themeToCssVars } from '../../theme'
import type { StorefrontBootstrap } from '../../types'
import { PageRenderer } from '../page-renderer'
import { playMotion } from '../motion'
import { NODE_ID } from '../registry'
import type { BuilderPage, RenderColumn, RenderElement, RenderSection } from '../types'
import { CANVAS_SURROUNDINGS, envelope, isEditorShortcut, readParentMessage, type CanvasMessage, type CanvasSurroundings, type ParentMessage, type Rect } from './protocol'
import { sanitizeHtml } from './sanitize'
import { mergeThemeSettings, type CanvasThemeSettings } from './theme-override'

/*
 * The store builder canvas (B2), inside the editor's iframe at /admin/builder-canvas. It draws the
 * draft the editor sends with the storefront's own renderer, theme and language, and reports
 * back where every node is (`rects`), what was clicked or hovered and the editor's shortcut keys.
 * It is display-only: clicks never reach links, buttons or forms; nothing is fetched from the
 * store API (the query client is offline, see ./main.tsx).
 */

type RenderFrame = Extract<ParentMessage, { type: 'render' }>
type InitFrame = Extract<ParentMessage, { type: 'init' }>

const noop = () => {}

/** Text and custom HTML elements from the unsaved draft are cleaned here too (the canvas shares the admin's origin). */
function cleanSections(sections: RenderSection[]): RenderSection[] {
  const element = (node: RenderElement): RenderElement => {
    if (node.type === 'text' || node.type === 'custom_html') return { ...node, props: { ...node.props, html: sanitizeHtml(String(node.props?.html ?? ''), { dropClassAndId: node.type === 'custom_html' }) } } as RenderElement
    if ('columns' in node && Array.isArray(node.columns)) return { ...node, columns: node.columns.map(column) } as RenderElement
    return node
  }
  const column = (col: RenderColumn): RenderColumn => ({ ...col, elements: Array.isArray(col.elements) ? col.elements.map(element) : [] })
  return (Array.isArray(sections) ? sections : []).map((section) => ({ ...section, columns: Array.isArray(section.columns) ? section.columns.map(column) : [] }))
}

const safeIds = (ids: readonly (string | null | undefined)[]) => ids.filter((id): id is string => typeof id === 'string' && NODE_ID.test(id))

/** Outlines for the selection, hover and nodes with problems; ids are checked against the id pattern before they reach a selector. */
function outlineCss(frame: RenderFrame | null): string {
  if (!frame) return ''
  const rules: string[] = []
  const [selection] = safeIds([frame.selection])
  const [hover] = safeIds([frame.hover])
  for (const id of safeIds(frame.errors ?? [])) rules.push(`[data-b="${id}"]{outline:2px solid #dc2626 !important;outline-offset:-2px}`)
  if (hover && hover !== selection) rules.push(`[data-b="${hover}"]{outline:1px dashed #2563eb !important;outline-offset:-1px}`)
  if (selection) rules.push(`[data-b="${selection}"]{outline:2px solid #2563eb !important;outline-offset:-2px}`)
  return rules.join('\n')
}

/** Editor-only affordances: empty columns get room to drop into; nothing looks clickable. */
const EDITOR_CSS = `
.b-col:empty{min-height:72px;outline:1px dashed #94a3b8;outline-offset:-6px;background:repeating-linear-gradient(135deg,transparent 0 8px,rgba(148,163,184,.12) 8px 16px)}
.b-page a,.b-page button,.b-page input,.b-page label{cursor:default}
html{scroll-behavior:auto}
`

const PRODUCT_TYPES = new Set(['product_grid', 'product_carousel', 'product_tabs', 'hot_deals', 'category_strip', 'brand_strip', 'blog_posts'])

/** A grey shape of the element's type while its data loads. */
function Skeleton({ element }: { element: RenderElement }) {
  const bar = 'rounded bg-neutral-200'
  let body: ReactNode
  if (element.type === 'hero_slider') body = <div className={`${bar} h-72 w-full`} />
  else if (element.type === 'banner_grid') body = <div className="grid grid-cols-3 gap-4">{[0, 1, 2].map((i) => <div key={i} className={`${bar} h-40`} />)}</div>
  else if (PRODUCT_TYPES.has(element.type)) {
    body = (
      <>
        <div className={`${bar} mx-auto mb-6 h-7 w-56`} />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className={`${bar} h-48`} />)}</div>
      </>
    )
  } else body = <div className="space-y-3"><div className={`${bar} h-6 w-1/2`} /><div className={`${bar} h-4 w-full`} /><div className={`${bar} h-4 w-5/6`} /></div>
  return (
    <div data-b={element.id} data-testid="canvas-skeleton" aria-busy="true" className="mx-auto max-w-sf animate-pulse px-4 py-10">
      {body}
    </div>
  )
}

/* ----------------------------------------------------------------------------------------------
 * B4: the faded page around a header, footer or zone
 * -------------------------------------------------------------------------------------------- */

const block = 'rounded bg-neutral-300'

function Sample({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div aria-hidden="true" data-testid="canvas-sample" className="pointer-events-none select-none bg-neutral-50 py-8 opacity-50">
      <div className="mx-auto max-w-sf px-4">
        <p className="mb-4 text-xs font-semibold tracking-wide text-neutral-500 uppercase">{label}</p>
        {children}
      </div>
    </div>
  )
}

function PageSample() {
  return (
    <Sample label="Your page content">
      <div className={`${block} mb-6 h-56 w-full`} />
      <div className="mb-6 grid grid-cols-3 gap-4">{[0, 1, 2].map((i) => <div key={i} className={`${block} h-32`} />)}</div>
      <div className="space-y-2"><div className={`${block} h-4 w-2/3`} /><div className={`${block} h-4 w-1/2`} /></div>
    </Sample>
  )
}

function GridSample() {
  return (
    <Sample label="Product grid (filled in by your shop)">
      <div className="mb-4 flex items-center justify-between"><div className={`${block} h-5 w-40`} /><div className={`${block} h-8 w-32`} /></div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="space-y-2"><div className={`${block} aspect-square`} /><div className={`${block} h-4 w-3/4`} /><div className={`${block} h-4 w-1/3`} /></div>
        ))}
      </div>
    </Sample>
  )
}

function ProductSample() {
  return (
    <Sample label="Product details (filled in for each product)">
      <div className="grid gap-6 md:grid-cols-2">
        <div className={`${block} aspect-square`} />
        <div className="space-y-3"><div className={`${block} h-7 w-3/4`} /><div className={`${block} h-6 w-1/4`} /><div className={`${block} h-4 w-full`} /><div className={`${block} h-4 w-5/6`} /><div className={`${block} h-11 w-40`} /></div>
      </div>
    </Sample>
  )
}

/** Where the document sits: the sample before it, the sample after it. */
function surroundingSamples(surroundings: CanvasSurroundings): { before: ReactNode; after: ReactNode } {
  switch (surroundings) {
    case 'header':
      return { before: null, after: <PageSample /> }
    case 'footer':
      return { before: <PageSample />, after: null }
    case 'zone:listing.top':
      return { before: null, after: <GridSample /> }
    case 'zone:listing.bottom':
      return { before: <GridSample />, after: null }
    case 'zone:product.after':
      return { before: <ProductSample />, after: null }
    default:
      return { before: null, after: null }
  }
}

const EMPTY_TEXT = 'This page is empty. Drag an element from the Add panel onto this area, or click one to add it.'

function useThemeEffects(bootstrap: StorefrontBootstrap | null) {
  const theme = bootstrap?.theme
  useLayoutEffect(() => (theme ? applyCssVars(document.documentElement, themeToCssVars(theme)) : undefined), [theme])
  useLayoutEffect(() => (theme ? applyDataAttributes(document.documentElement, themeDataAttributes(theme)) : undefined), [theme])
}

type Props = {
  /** The editor window (tests pass their own). */
  parent?: Window
  origin?: string
}

export function CanvasApp({ parent = window.parent, origin = window.location.origin }: Props) {
  const [init, setInit] = useState<InitFrame | null>(null)
  const [frame, setFrame] = useState<RenderFrame | null>(null)
  const [themeDraft, setThemeDraft] = useState<CanvasThemeSettings | null>(null)
  const pendingRects = useRef(false)
  const queryClient = useQueryClient()

  const post = useCallback((message: CanvasMessage) => parent.postMessage(envelope(message), origin), [parent, origin])

  const reportRects = useCallback(() => {
    if (pendingRects.current) return
    pendingRects.current = true
    requestAnimationFrame(() => {
      pendingRects.current = false
      const nodes: Record<string, Rect> = {}
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-b]'))) {
        const id = el.dataset.b
        if (!id || Object.hasOwn(nodes, id)) continue
        const r = el.getBoundingClientRect()
        nodes[id] = { x: r.x, y: r.y, w: r.width, h: r.height }
      }
      post({ type: 'rects', nodes, scrollY: window.scrollY, height: document.documentElement.scrollHeight, viewport: { w: window.innerWidth, h: window.innerHeight } })
    })
  }, [post])

  // Messages from the editor.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message = readParentMessage(event, origin, parent)
      if (!message) return
      if (message.type === 'init') {
        // Anything that reads the bootstrap from the cache finds the editor's copy.
        queryClient.setQueryData(storefrontKeys.bootstrapFor(null), message.bootstrap)
        const requested = parseLocale(message.locale)
        if (requested) queryClient.setQueryData(storefrontKeys.bootstrapFor(requested), message.bootstrap)
        setInit(message)
      }
      else if (message.type === 'render') setFrame(message)
      else if (message.type === 'theme') setThemeDraft(message.settings)
      else if (message.type === 'scroll-to') {
        if (!NODE_ID.test(message.id)) return
        const el = document.querySelector(`[data-b="${message.id}"]`)
        if (!el) return
        const r = el.getBoundingClientRect()
        if (r.top < 0 || r.bottom > window.innerHeight) el.scrollIntoView({ block: r.height > window.innerHeight ? 'start' : 'center' })
      } else if (message.type === 'scroll-by' && Number.isFinite(message.dy)) window.scrollBy(0, Math.max(-200, Math.min(200, message.dy)))
      else if (message.type === 'play-motion') {
        if (!NODE_ID.test(message.id)) return
        const el = document.querySelector<HTMLElement>(`[data-b="${message.id}"]`)
        if (el) playMotion(el)
      }
    }
    window.addEventListener('message', onMessage)
    post({ type: 'ready' })
    return () => window.removeEventListener('message', onMessage)
  }, [origin, parent, post, queryClient])

  // Display only: pointer input selects, links and forms do nothing, editor shortcuts go to the editor.
  useEffect(() => {
    let hovered: string | null = null
    const idAt = (target: EventTarget | null) => (target instanceof Element ? (target.closest<HTMLElement>('[data-b]')?.dataset.b ?? null) : null)
    const swallow = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
    }
    const onClick = (event: MouseEvent) => {
      swallow(event)
      if (event.type === 'click') post({ type: 'click', id: idAt(event.target) })
    }
    const onOver = (event: MouseEvent) => {
      const id = idAt(event.target)
      if (id === hovered) return
      hovered = id
      post({ type: 'hover', id })
    }
    const onLeave = () => {
      if (hovered === null) return
      hovered = null
      post({ type: 'hover', id: null })
    }
    const onKey = (event: KeyboardEvent) => {
      if (!isEditorShortcut(event)) return
      event.preventDefault()
      post({ type: 'key', key: event.key, ctrl: event.ctrlKey, shift: event.shiftKey, meta: event.metaKey })
    }
    const options = { capture: true }
    document.addEventListener('click', onClick, options)
    document.addEventListener('auxclick', onClick, options)
    document.addEventListener('dblclick', swallow, options)
    document.addEventListener('pointerdown', swallow, options)
    document.addEventListener('mousedown', swallow, options)
    document.addEventListener('submit', swallow, options)
    document.addEventListener('dragstart', swallow, options)
    document.addEventListener('mouseover', onOver, options)
    document.documentElement.addEventListener('mouseleave', onLeave)
    document.addEventListener('keydown', onKey, options)
    window.addEventListener('scroll', reportRects, { passive: true })
    window.addEventListener('resize', reportRects)
    // Images change the layout as they load.
    document.addEventListener('load', reportRects, options)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(reportRects)
    observer?.observe(document.body)
    return () => {
      document.removeEventListener('click', onClick, options)
      document.removeEventListener('auxclick', onClick, options)
      document.removeEventListener('dblclick', swallow, options)
      document.removeEventListener('pointerdown', swallow, options)
      document.removeEventListener('mousedown', swallow, options)
      document.removeEventListener('submit', swallow, options)
      document.removeEventListener('dragstart', swallow, options)
      document.removeEventListener('mouseover', onOver, options)
      document.documentElement.removeEventListener('mouseleave', onLeave)
      document.removeEventListener('keydown', onKey, options)
      window.removeEventListener('scroll', reportRects)
      window.removeEventListener('resize', reportRects)
      document.removeEventListener('load', reportRects, options)
      observer?.disconnect()
    }
  }, [post, reportRects])

  const initial = init?.bootstrap ?? null
  // The theme draft (Site styles) over the bootstrap theme: everything that reads the theme sees it.
  const bootstrap = useMemo(() => (initial && themeDraft ? { ...initial, theme: mergeThemeSettings(initial.theme, themeDraft) } : initial), [initial, themeDraft])
  const locale: Locale = parseLocale(init?.locale) ?? 'en'
  useThemeEffects(bootstrap)
  useLayoutEffect(() => {
    document.documentElement.lang = locale
    setLocaleRuntime({ lang: locale, banglaDigits: locale === 'bn' && bootstrap?.store.bangla_digits === true })
  }, [locale, bootstrap])
  useLayoutEffect(() => {
    if (frame?.device) document.documentElement.dataset.device = frame.device
  }, [frame?.device])

  const loaded = useDictionary(locale)
  const localeValue = useMemo(
    () =>
      loaded && bootstrap
        ? buildLocaleValue({
            locale: loaded.locale,
            dictionary: loaded.dictionary,
            locales: [loaded.locale],
            defaultLocale: loaded.locale,
            banglaDigits: loaded.locale === 'bn' && bootstrap.store.bangla_digits === true,
            setLocale: noop,
          })
        : null,
    [loaded, bootstrap],
  )

  const sections = useMemo(() => (frame ? cleanSections(frame.sections) : []), [frame])
  const page = useMemo<BuilderPage | null>(
    () => (frame ? { document: { id: 'draft', key: 'canvas', title: '', version: null, source: 'draft' }, sections, media: frame.media ?? {}, data: frame.data ?? {} } : null),
    [frame, sections],
  )
  const pending = useMemo(() => new Set(frame?.pending ?? []), [frame])
  const surroundings: CanvasSurroundings = frame?.surroundings && CANVAS_SURROUNDINGS.includes(frame.surroundings) ? frame.surroundings : 'page'
  const samples = useMemo(() => surroundingSamples(surroundings), [surroundings])
  const placeholder = useCallback((element: RenderElement) => (pending.has(element.id) ? <Skeleton element={element} /> : null), [pending])

  // Report positions after every drawn frame.
  useLayoutEffect(() => {
    if (page) reportRects()
  }, [page, reportRects, localeValue])

  if (!bootstrap || !localeValue || !page) {
    return (
      <div role="status" className="grid min-h-screen place-items-center">
        <span className="size-10 animate-spin rounded-full border-4 border-neutral-200 border-t-neutral-500" aria-hidden />
        <span className="sr-only">Loading the canvas</span>
      </div>
    )
  }

  return (
    <LocaleContext value={localeValue}>
      <BootstrapContext value={bootstrap}>
        <NoticeProvider>
          <style data-testid="canvas-editor-css">{EDITOR_CSS}</style>
          <style data-testid="canvas-outlines">{outlineCss(frame)}</style>
          <main id="main" className="min-h-screen" data-surroundings={surroundings}>
            {surroundings === 'header' && frame?.device === 'mobile' && (
              <p role="note" data-testid="canvas-compact-note" className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-xs text-amber-900">
                Phones (narrower than 768 px) show your store’s compact header instead of this one. Switch to tablet or desktop to see it in use.
              </p>
            )}
            {samples.before}
            {page.sections.length === 0 ? (
              <div data-testid="canvas-empty" className={`grid place-items-center p-8 text-center text-neutral-500 ${surroundings === 'page' ? 'min-h-[60vh]' : 'min-h-40 border-y border-dashed border-neutral-300'}`}>
                <p className="max-w-sm text-sm">{typeof frame?.emptyText === 'string' && frame.emptyText ? frame.emptyText : EMPTY_TEXT}</p>
              </div>
            ) : surroundings === 'header' ? (
              <header data-canvas-part="header">
                <PageRenderer page={page} placeholder={placeholder} />
              </header>
            ) : surroundings === 'footer' ? (
              <footer data-canvas-part="footer">
                <PageRenderer page={page} placeholder={placeholder} />
              </footer>
            ) : (
              <PageRenderer page={page} placeholder={placeholder} />
            )}
            {samples.after}
          </main>
        </NoticeProvider>
      </BootstrapContext>
    </LocaleContext>
  )
}
