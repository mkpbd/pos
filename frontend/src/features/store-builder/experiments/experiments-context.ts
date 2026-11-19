import { createContext, useContext } from 'react'
import { ApiError } from '@/lib/api/client'
import type { ExperimentAction } from './experiments-api'
import type { ExperimentArm } from './experiments-model'

/*
 * B13: the editor's A/B test state (provided by ./experiments-provider.tsx) — whether the A/B
 * tests panel is open (and which test it points at), the version of each test the canvas shows,
 * and the server actions (start, stop, keep).
 */

/** What the provider needs of the autosave (../autosave.ts). */
export type ExperimentAutosave = { flush: () => Promise<boolean>; reset: () => void }

export type ExperimentsUi = {
  open: boolean
  setOpen: (open: boolean) => void
  /** Opens the panel at a test (null: the list). */
  openTest: (experimentId: string | null) => void
  /** The test the panel scrolls to (set by openTest). */
  focusId: string | null
  /** What runs whenever the panel opens: the editor puts away the panels it replaces (Check page, Insights). */
  setBeforeOpen: (run: (() => void) | null) => void
  /** The version picked for each test on the canvas (absent: the default). */
  picked: Readonly<Record<string, ExperimentArm>>
  pick: (experimentId: string, arm: ExperimentArm) => void
  /** Runs a server action; resolves true when the draft was replaced. */
  run: (experimentId: string, action: ExperimentAction) => Promise<boolean>
  /** The action in flight (`<id>:<kind>`), for busy buttons. */
  pending: string | null
}

export const ExperimentsContext = createContext<ExperimentsUi | null>(null)

/** The A/B test state; null outside the editor's provider (menus then offer nothing). */
export function useExperimentsUi(): ExperimentsUi | null {
  return useContext(ExperimentsContext)
}

export function actionError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) return 'This page was changed somewhere else (another tab or person). Reload the page builder and try again.'
    if (error.status === 403) return 'Only people who may publish can start, stop or finish A/B tests.'
    if (error.code === 'EXPERIMENT_NEEDS_BOTH_ARMS') return 'Both versions need at least one section before the test can start.'
    if (error.code === 'EXPERIMENT_STATUS') return 'The test has changed in the meantime. Reload the page builder to see where it stands.'
    return error.message
  }
  return 'Something went wrong. Try again.'
}
