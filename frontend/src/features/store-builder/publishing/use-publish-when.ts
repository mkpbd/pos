import { useState } from 'react'
import { toZonedInput } from '@/features/promotions/zoned-time'
import type { DocumentSchedule } from '../publishing-api'
import { checkScheduleInput, defaultScheduleInput, type ScheduleCheck } from './schedule-time'

/* B11: the state of "When should it go live?" (see ./publish-when.tsx for the fields). */

/** "Publish later" for people with the publish permission. */
export type PublishLater = {
  /** The store's timezone (the organization's); the time is chosen in it. */
  timeZone: string | undefined
  /** The pending planned publish a new one replaces (null: none). */
  current: DocumentSchedule | null
  onSchedule: (publishAt: string, note: string | null) => void
}

export type PublishWhen = {
  later: PublishLater | undefined
  mode: 'now' | 'later'
  setMode: (mode: 'now' | 'later') => void
  at: string
  setAt: (value: string) => void
  atError: string | null
  setAtError: (error: string | null) => void
  cancelPlanned: boolean
  setCancelPlanned: (value: boolean) => void
  /** "Publish later" chosen. */
  scheduling: boolean
  checked: ScheduleCheck | null
  /** The pending plan (null: none). */
  replaces: DocumentSchedule | null
  /** The publish options for "now" (`cancelSchedule` only when a plan is pending). */
  nowOptions: { cancelSchedule?: boolean }
  /** Validates "later": the instant, or null with the error shown. */
  laterInstant: () => string | null
}

/** The dialog's choice; reset each time `open` turns true. */
export function usePublishWhen(open: boolean, later: PublishLater | undefined): PublishWhen {
  const [mode, setMode] = useState<'now' | 'later'>('now')
  const [at, setAt] = useState('')
  const [atError, setAtError] = useState<string | null>(null)
  const [cancelPlanned, setCancelPlanned] = useState(true)
  const [wasOpen, setWasOpen] = useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      const pendingAt = later?.current?.status === 'pending' ? later.current.publish_at : null
      setMode('now')
      setAt(pendingAt ? toZonedInput(pendingAt, later?.timeZone) : defaultScheduleInput(later?.timeZone))
      setAtError(null)
      setCancelPlanned(true)
    }
  }
  const scheduling = later !== undefined && mode === 'later'
  const checked = scheduling ? checkScheduleInput(at, later.timeZone) : null
  const replaces = later?.current?.status === 'pending' ? later.current : null
  return {
    later,
    mode,
    setMode,
    at,
    setAt,
    atError,
    setAtError,
    cancelPlanned,
    setCancelPlanned,
    scheduling,
    checked,
    replaces,
    nowOptions: replaces ? { cancelSchedule: cancelPlanned } : {},
    laterInstant: () => {
      if (checked?.ok) return checked.iso
      setAtError(checked && !checked.ok ? checked.error : 'Choose the date and time it should go live.')
      return null
    },
  }
}
