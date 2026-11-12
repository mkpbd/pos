import { AppWindowIcon, Maximize2Icon, PanelBottomIcon, PanelTopIcon, PictureInPicture2Icon, type LucideIcon } from 'lucide-react'
import type { PopupLayout, PopupSettings } from '@/storefront/builder/types'
import { B8B_LIMITS, B8B_TEXT_LIMITS, isPopupBlockedPathname, normalizePopupSettings, popupSettingsProblems } from '@/storefront/builder/validate'
import type { PopupStatus, PopupSummary } from './api'

/*
 * B8b popups & bars in the editor: reading the popup settings of a draft (`content.popup`,
 * versioned with it), the client checks in plain words (keyed like the server's
 * `popup.trigger.delay_seconds`), what a layout change does, and the status the start screen shows
 * when the server sends none.
 */

export type { PopupLayout, PopupSettings }

/** The popup settings of a draft, every key filled (a draft without them gets the defaults). */
export function readPopupSettings(value: unknown): PopupSettings {
  // Keep what the person typed even while it is out of range (normalize would replace it), so the field can say what is wrong.
  const normalized = normalizePopupSettings(value)
  if (typeof value !== 'object' || value === null) return normalized
  const raw = value as Partial<PopupSettings>
  const keep = <T,>(v: T | undefined, fallback: T): T => (v === undefined ? fallback : v)
  return {
    ...normalized,
    priority: typeof raw.priority === 'number' ? raw.priority : normalized.priority,
    trigger: {
      ...normalized.trigger,
      delay_seconds: typeof raw.trigger?.delay_seconds === 'number' ? raw.trigger.delay_seconds : normalized.trigger.delay_seconds,
      scroll_percent: typeof raw.trigger?.scroll_percent === 'number' ? raw.trigger.scroll_percent : normalized.trigger.scroll_percent,
    },
    frequency: { ...normalized.frequency, days: typeof raw.frequency?.days === 'number' ? raw.frequency.days : normalized.frequency.days },
    pages: { kind: normalized.pages.kind, paths: Array.isArray(raw.pages?.paths) ? raw.pages.paths.filter((p): p is string => typeof p === 'string') : [] },
    label: typeof raw.label === 'string' ? raw.label : normalized.label,
    starts_at: keep(raw.starts_at, normalized.starts_at),
    ends_at: keep(raw.ends_at, normalized.ends_at),
  }
}

/** The server's form of a "show on" address: lower case, `/` first, letters, digits and `/ _ . ~ -`, at most 120 after the slash. */
const SERVER_PATH = /^\/[a-z0-9][a-z0-9/_.~-]{0,119}$/

/** What is wrong with one "show on" address, or null. */
export function popupPathProblem(path: string): string | null {
  const value = path.trim()
  if (value === '') return 'Enter a page address, e.g. /p/eid-sale.'
  if (!value.startsWith('/')) return 'Start with “/”, e.g. /p/eid-sale.'
  if (value === '/') return 'For the home page, choose “Home page only” above.'
  if (isPopupBlockedPathname(value.toLowerCase())) return 'Popups never show on the cart, checkout, account or order pages.'
  if (value.length > 121) return 'At most 120 characters after the “/”.'
  if (!SERVER_PATH.test(value)) return 'Use small letters, digits, “-” and “/” only (no spaces, “?” or “#”).'
  return null
}

const PLAIN: Record<string, (code: string) => string> = {
  'trigger.delay_seconds': () => `Use ${B8B_LIMITS.popupDelay.min}–${B8B_LIMITS.popupDelay.max} seconds.`,
  'trigger.scroll_percent': () => `Use ${B8B_LIMITS.popupScroll.min}–${B8B_LIMITS.popupScroll.max} %.`,
  'frequency.days': () => `Use ${B8B_LIMITS.popupDays.min}–${B8B_LIMITS.popupDays.max} days.`,
  priority: () => `Use a whole number from ${B8B_LIMITS.popupPriority.min} to ${B8B_LIMITS.popupPriority.max}.`,
  'pages.paths': (code) => (code === 'too_few' ? 'Add at least one page address.' : `At most ${B8B_LIMITS.popupPaths.max} addresses.`),
  label: () => `At most ${B8B_TEXT_LIMITS.popup.label} characters.`,
  ends_at: (code) => (code === 'out_of_range' ? 'The end must be after the start.' : 'Enter a date and time.'),
  starts_at: () => 'Enter a date and time.',
}

/**
 * Client checks of the popup settings in plain words, keyed like the server's problems
 * (`popup.trigger.delay_seconds`, `popup.pages.paths.2`, `popup.ends_at`). Only the fields the
 * current choices show are checked (a hidden delay keeps whatever it had).
 */
export function popupProblems(p: PopupSettings): Record<string, string> {
  const errors: Record<string, string> = {}
  const shown = (path: string) => {
    if (path === 'trigger.delay_seconds') return p.trigger.kind !== 'on_scroll'
    if (path === 'trigger.scroll_percent') return p.trigger.kind === 'on_scroll'
    if (path === 'frequency.days') return p.frequency.kind === 'once_every_days'
    if (path.startsWith('pages.paths')) return p.pages.kind === 'paths'
    return true
  }
  for (const problem of popupSettingsProblems(p)) {
    if (!shown(problem.path)) continue
    const index = /^pages\.paths\.(\d+)$/.exec(problem.path)
    if (index) {
      const path = p.pages.paths[Number(index[1])] ?? ''
      errors[`popup.${problem.path}`] = problem.code === 'duplicate' ? 'This address is in the list already.' : (popupPathProblem(path) ?? 'Check this address.')
      continue
    }
    errors[`popup.${problem.path}`] ??= PLAIN[problem.path]?.(problem.code) ?? 'Check this value.'
  }
  // The server's stricter address rules (lower case, blocked pages) — warn before saving.
  if (p.pages.kind === 'paths') {
    p.pages.paths.forEach((path, i) => {
      const problem = popupPathProblem(path)
      if (problem) errors[`popup.pages.paths.${i}`] ??= problem
    })
  }
  return errors
}

/** Whether the layout has a size / a dimmed page behind it / is a bar. */
export const hasWidth = (layout: PopupLayout) => layout === 'modal' || layout === 'slide_in'
export const hasOverlay = (layout: PopupLayout) => layout === 'modal' || layout === 'fullscreen'
export const isBar = (layout: PopupLayout) => layout === 'bar_top' || layout === 'bar_bottom'

/** Settings after a layout change: a modal or full screen starts dimmed; the rest keep their values. */
export function withLayout(p: PopupSettings, layout: PopupLayout): PopupSettings {
  return { ...p, layout, overlay: hasOverlay(layout) ? (hasOverlay(p.layout) ? p.overlay : true) : p.overlay }
}

/** Settings with the "where" changed: paths are sent only for "pages I choose" (the server keeps others as given). */
export function withPagesKind(p: PopupSettings, kind: PopupSettings['pages']['kind']): PopupSettings {
  return { ...p, pages: { kind, paths: kind === 'paths' ? p.pages.paths : [] } }
}

/**
 * A popup's state on the store: the server's `status` when it sends one, else from what the
 * summary says (published? switched on? inside its schedule?).
 */
export function popupStatus(summary: { status?: PopupStatus | null; published: unknown; active?: boolean | null; popup?: PopupSummary | null }, now = Date.now()): PopupStatus {
  if (summary.status) return summary.status
  if (!summary.published) return 'draft'
  if (!summary.active) return 'off'
  const starts = summary.popup?.starts_at ? Date.parse(summary.popup.starts_at) : null
  const ends = summary.popup?.ends_at ? Date.parse(summary.popup.ends_at) : null
  if (ends !== null && ends <= now) return 'expired'
  if (starts !== null && starts > now) return 'scheduled'
  return 'live'
}

/** The list icon of each layout (start screen). */
export const POPUP_LAYOUT_ICONS: Record<PopupLayout, LucideIcon> = {
  modal: AppWindowIcon,
  slide_in: PictureInPicture2Icon,
  bar_top: PanelTopIcon,
  bar_bottom: PanelBottomIcon,
  fullscreen: Maximize2Icon,
}

/** The layout of the built-in popup templates (the template list does not say). */
export const POPUP_TEMPLATE_LAYOUTS: Record<string, PopupLayout> = {
  'popup-newsletter': 'modal',
  'popup-exit-offer': 'modal',
  'popup-free-delivery-bar': 'bar_top',
  'popup-eid-sale': 'slide_in',
  'popup-cookie-notice': 'bar_bottom',
  'popup-contact-form': 'modal',
}
