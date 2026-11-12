import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { ApiError } from '@/lib/api/client'
import { useMediaQuery } from '../../components/use-media-query'
import { storeApi } from '../../http'
import { useLocale } from '../../i18n/locale'
import { customerKeys, localized } from '../../store-keys'
import type { Customer } from '../../types'
import type { BuilderPage, StorePopupEntry } from '../types'
import { usePopupPreviewId, usePopupsQuery } from './api'
import { PopupFrame, type PopupCloseReason } from './popup-frame'
import { isPopupDue, markPopupActed, markPopupClosed, markPopupShown, matchesAudience, matchesDevice, matchesPage, MOBILE_QUERY, popupSlot, type PopupSlot } from './rules'
import { armTrigger } from './triggers'

/*
 * B8b: the store's builder popups and bars (contract §1), mounted once in the store layout. It
 * loads after the first paint, keeps the popups whose pages / devices / audience / frequency fit,
 * arms their triggers per page view and shows what fired: at most one modal, fullscreen or
 * slide-in at a time (the server's order: priority, then oldest), at most one bar per edge, and
 * never a modal-like popup over another open dialog. `?preview=draft&popup=<id>` (staff) shows
 * that popup's draft at once, whatever its trigger and rules, and remembers nothing.
 */

type View = { path: string; fired: string[]; closed: string[] }
type Showing = Record<PopupSlot, string | null>

const NONE: Showing = { modal: null, top: null, bottom: null }
const SLOTS: readonly PopupSlot[] = ['modal', 'top', 'bottom']
/** How often a waiting modal-like popup checks whether another dialog has closed. */
const RETRY_MS = 1000

/** Another dialog (cart drawer, quick view, the classic popup banner) is open: a modal-like popup waits. */
function otherDialogOpen(): boolean {
  return document.querySelector('[aria-modal="true"]:not(.b-popup), [role="dialog"][data-state="open"]:not(.b-popup)') !== null
}

/** Signed in or not; null while unknown. Only asked when a popup has an audience. */
function useSignedIn(enabled: boolean): boolean | null {
  const { locale } = useLocale()
  const me = useQuery({
    queryKey: localized(customerKeys.me, locale),
    queryFn: ({ signal }) => storeApi.get<Customer | null>('/store/account/me', { signal }).then((r) => r.data ?? null),
    staleTime: 5 * 60_000,
    retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 1,
    enabled,
  })
  if (me.data !== undefined) return me.data !== null
  return me.isError ? false : null
}

function popupPage(popup: StorePopupEntry, draft: boolean): BuilderPage {
  return { document: { id: popup.id, key: `popup:${popup.id}`, title: '', version: popup.version, source: draft ? 'draft' : 'published' }, ...popup.payload }
}

export function PopupHost() {
  const { t } = useLocale()
  const [ready, setReady] = useState(false)
  // After the first paint: popups never hold up the page.
  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), 0)
    return () => window.clearTimeout(timer)
  }, [])

  const query = usePopupsQuery(ready)
  const previewId = usePopupPreviewId()
  const preview = previewId !== null
  const popups = useMemo(() => query.data?.popups ?? [], [query.data])
  const neverOn = useMemo(() => query.data?.never_on ?? [], [query.data])
  const { pathname } = useLocation()
  const mobile = useMediaQuery(MOBILE_QUERY)
  const signedIn = useSignedIn(!preview && popups.some((popup) => popup.settings.audience !== 'all'))

  const [view, setView] = useState<View>({ path: pathname, fired: [], closed: [] })
  const [showing, setShowing] = useState<Showing>(NONE)
  const [tick, setTick] = useState(0)
  // A new page view: triggers re-arm and every_page_view popups may show again.
  if (view.path !== pathname) setView({ path: pathname, fired: [], closed: [] })

  /** The rules that do not change while the visitor stays on the page. */
  const fits = useCallback(
    (popup: StorePopupEntry) => {
      if (!matchesPage(preview ? { pages: { kind: 'all', paths: [] } } : popup.settings, pathname, neverOn)) return false
      if (preview) return popup.id === previewId
      return matchesDevice(popup.settings, mobile) && matchesAudience(popup.settings, signedIn)
    },
    [pathname, neverOn, preview, previewId, mobile, signedIn],
  )

  // Arm the triggers of the popups that fit and are due.
  useEffect(() => {
    const disarm: (() => void)[] = []
    for (const popup of popups) {
      if (!fits(popup)) continue
      const fire = () => setView((v) => (v.path !== pathname || v.fired.includes(popup.id) || v.closed.includes(popup.id) ? v : { ...v, fired: [...v.fired, popup.id] }))
      if (preview) {
        fire()
        continue
      }
      if (!isPopupDue(popup.id, popup.settings)) continue
      disarm.push(armTrigger(popup.settings.trigger, fire))
    }
    return () => disarm.forEach((off) => off())
  }, [popups, fits, preview, pathname])

  // Fill the free slots with what fired, in the server's order; drop a shown popup the new page does not allow.
  useEffect(() => {
    if (view.path !== pathname) return
    let waiting = false
    let retry = 0
    const fill = () => setShowing((current) => {
      let next = current
      for (const slot of SLOTS) {
        const id = next[slot]
        const popup = id ? popups.find((p) => p.id === id) : undefined
        if (id && (!popup || !fits(popup) || view.closed.includes(id))) next = { ...next, [slot]: null }
      }
      for (const slot of SLOTS) {
        if (next[slot]) continue
        const candidate = popups.find((p) => popupSlot(p.settings.layout) === slot && view.fired.includes(p.id) && !view.closed.includes(p.id) && fits(p) && !SLOTS.some((s) => next[s] === p.id))
        if (!candidate) continue
        if (slot === 'modal' && otherDialogOpen()) {
          waiting = true
          continue
        }
        next = { ...next, [slot]: candidate.id }
      }
      if (waiting && !retry) retry = window.setTimeout(() => setTick((n) => n + 1), RETRY_MS)
      return next
    })
    // One tick later: a dialog that opened in the same render (cart drawer, quick view) is in the DOM by then.
    const timer = window.setTimeout(fill, 0)
    return () => {
      window.clearTimeout(timer)
      window.clearTimeout(retry)
    }
  }, [view, pathname, popups, fits, tick])

  // Remember what was shown (not in a draft preview).
  useEffect(() => {
    if (preview) return
    for (const slot of SLOTS) {
      const id = showing[slot]
      if (id) markPopupShown(id)
    }
  }, [showing, preview])

  const close = useCallback(
    (id: string, reason: PopupCloseReason) => {
      if (!preview && reason !== 'link') markPopupClosed(id)
      setView((v) => (v.closed.includes(id) ? v : { ...v, closed: [...v.closed, id] }))
      setShowing((current) => Object.fromEntries(SLOTS.map((slot) => [slot, current[slot] === id ? null : current[slot]])) as Showing)
    },
    [preview],
  )
  const acted = useCallback(
    (id: string) => {
      if (!preview) markPopupActed(id)
    },
    [preview],
  )

  const shown = SLOTS.map((slot) => showing[slot]).flatMap((id) => {
    const popup = id ? popups.find((p) => p.id === id) : undefined
    return popup ? [popup] : []
  })
  if (shown.length === 0) return null

  return (
    <>
      {preview && (
        <p role="note" data-testid="popup-preview-note" className="fixed top-2 left-1/2 z-[70] -translate-x-1/2 rounded-full bg-amber-100 px-4 py-1 text-xs font-semibold text-amber-950 shadow">
          {t('promo.popup.preview')}
        </p>
      )}
      {shown.map((popup) => (
        <PopupFrame
          key={popup.id}
          id={popup.id}
          settings={popup.settings}
          page={popupPage(popup, preview)}
          onClose={(reason) => close(popup.id, reason)}
          onActed={() => acted(popup.id)}
        />
      ))}
    </>
  )
}
