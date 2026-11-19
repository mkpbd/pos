import { createContext, useContext } from 'react'
import { evaluateAudience, readAudience } from './evaluate'
import type { AudienceCampaigns, AudienceContext } from './types'

/* B13: what PageRenderer's nodes read to decide whether they show (see ./audience-runtime.tsx). */

export type AudienceRuntime =
  /** Nothing on this page has rules (or the canvas, which fades nodes itself): draw everything. */
  | { mode: 'off' }
  /** The store: `context` null while it is still being gathered. */
  | { mode: 'live'; context: AudienceContext | null; campaigns: AudienceCampaigns | null }

export const AudienceCtx = createContext<AudienceRuntime>({ mode: 'off' })

/** Whether a node is drawn: true without rules or while audiences are off; false until the context is known. */
export function useAudienceShows(node: { audience?: unknown }): boolean {
  const runtime = useContext(AudienceCtx)
  if (runtime.mode === 'off' || node.audience === undefined || node.audience === null) return true
  if (!readAudience(node.audience)) return true
  if (!runtime.context) return false
  return evaluateAudience(node.audience, runtime.context, { campaigns: runtime.campaigns })
}
