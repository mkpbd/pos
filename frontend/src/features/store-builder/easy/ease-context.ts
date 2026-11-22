import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { storedScreenLang } from '../pages/screen-language'
import { initialEase, writeEase, type EaseRecord, type TipId } from './ease-store'

/*
 * B21 Easy building inside the editor: Easy mode (fewer controls), the guided tour and the
 * one-line tips. The editor calls `useEase` once and provides `ui` through `EaseContext`; the
 * inspector, the Style tab and the tips read it with `useEaseUi()`. Outside the editor (or in
 * tests that render a part alone) the default is full mode with no tips.
 */

export type EaseLang = 'en' | 'bn'

export type EaseUi = {
  /** Easy mode is on: advanced controls are hidden. */
  easy: boolean
  setEasy: (on: boolean) => void
  /** Inside the editor: the Easy mode switch and the tips are offered. */
  available: boolean
  tipSeen: (id: TipId) => boolean
  seeTip: (id: TipId) => void
  /** The language of the tour and tips; `bangla`: the store has Bangla (English texts get a Bangla line). */
  lang: EaseLang
  bangla: boolean
}

export const EaseContext = createContext<EaseUi>({
  easy: false,
  setEasy: () => {},
  available: false,
  tipSeen: () => true,
  seeTip: () => {},
  lang: 'en',
  bangla: false,
})

export const useEaseUi = () => useContext(EaseContext)

/** The tour's and tips' language: Bangla while the canvas edits Bangla, else the Page builder screen's language. */
export function easeLang(editLocale: string, bangla: boolean): EaseLang {
  if (bangla && editLocale === 'bn') return 'bn'
  return storedScreenLang() === 'bn' ? 'bn' : 'en'
}

/** How long after opening the editor the tour starts by itself on a first visit (the toolbar and panels are drawn first). */
export const TOUR_DELAY = 600

export function useEase({ userId, editLocale, bangla }: { userId: string | null; editLocale: string; bangla: boolean }) {
  const [state, setState] = useState(() => ({ user: userId, ...initialEase(userId ?? '') }))
  if (state.user !== userId) setState({ user: userId, ...initialEase(userId ?? '') })
  const record = state.record
  const [tourOpen, setTourOpen] = useState(false)

  // Remembered per person (nothing is stored before we know who it is).
  useEffect(() => {
    if (userId) writeEase(userId, record)
  }, [userId, record])

  const update = useCallback((change: (record: EaseRecord) => EaseRecord) => setState((s) => ({ ...s, record: change(s.record) })), [])
  const setEasy = useCallback((easy: boolean) => update((r) => (r.easy === easy ? r : { ...r, easy })), [update])
  const seeTip = useCallback((id: TipId) => update((r) => (r.tips.includes(id) ? r : { ...r, tips: [...r.tips, id] })), [update])
  const resetTips = useCallback(() => {
    update((r) => ({ ...r, tips: [] }))
    toast.success('Tips will show again as you work.')
  }, [update])
  const startTour = useCallback(() => {
    update((r) => (r.tourSeen ? r : { ...r, tourSeen: true }))
    setTourOpen(true)
  }, [update])
  const closeTour = useCallback(() => setTourOpen(false), [])

  // A first visit: the tour starts by itself once — but never over someone who has already started
  // working (clicked, typed) or opened a dialog; it is offered again next time (More menu / Ctrl+K any time).
  const autoTour = userId !== null && !record.tourSeen
  useEffect(() => {
    if (!autoTour) return
    let busy = false
    const markBusy = () => {
      busy = true
    }
    window.addEventListener('pointerdown', markBusy, true)
    window.addEventListener('keydown', markBusy, true)
    const timer = setTimeout(() => {
      const dialogOpen = document.querySelector('[role="dialog"], [role="alertdialog"]') !== null
      if (!busy && !dialogOpen) startTour()
    }, TOUR_DELAY)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('pointerdown', markBusy, true)
      window.removeEventListener('keydown', markBusy, true)
    }
  }, [autoTour, startTour])

  const lang = easeLang(editLocale, bangla)
  const tips = record.tips
  const ui = useMemo<EaseUi>(
    () => ({ easy: record.easy, setEasy, available: true, tipSeen: (id) => tips.includes(id), seeTip, lang, bangla }),
    [record.easy, setEasy, tips, seeTip, lang, bangla],
  )
  return { ui, easy: record.easy, setEasy, tourOpen, startTour, closeTour, resetTips }
}
