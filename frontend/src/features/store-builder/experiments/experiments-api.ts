import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import type { DocumentDetail } from '../api'
import type { ExperimentArm, ExperimentGoal } from './experiments-model'

/*
 * B13 A/B tests — the admin API (contract: B13 backend §experiments).
 *  - GET  /storefront/builder/documents/{id}/experiments/{exp}/results?device=  (storefront.view)
 *  - POST …/experiments/{exp}/start | stop | keep {arm}, body {revision}        (manage + publish)
 * The actions write the draft only (they take effect when the page is published) and answer with
 * the same detail as PUT draft; 409 DRAFT_CONFLICT on a stale revision, 422 EXPERIMENT_STATUS /
 * EXPERIMENT_NEEDS_BOTH_ARMS. Results: counts, money as NUMERIC strings, `lift` and
 * `probability_b_beats_a` as percentage strings ("23.40", "96.12") or null.
 */

export type ResultsDevice = 'all' | 'desktop' | 'tablet' | 'mobile'
export type Confidence = 'low' | 'medium' | 'high'
export type Recommendation = 'keep_a' | 'keep_b' | 'keep_running'

export type ArmResult = {
  visitors: number
  views: number
  /** Goal events (orders, adds to cart or clicks — the test's goal). */
  goal_count: number
  /** Goal events per 100 visitors (worked out here from the counts; null without visitors). */
  rate: number | null
  orders: number
  /** NUMERIC string. */
  revenue: string
  add_to_carts: number
  clicks: number
  section_views: number
}

export type ExperimentDay = { day: string; A: { visitors: number; goal_count: number }; B: { visitors: number; goal_count: number } }

export type ExperimentResults = {
  goal: ExperimentGoal
  arms: Record<ExperimentArm, ArmResult>
  /** B's rate against A's, in % (+23.4 = 23.4 % more); null when A has none. */
  lift: number | null
  /** 0–100; null without visitors. */
  probability_b_beats_a: number | null
  confidence: Confidence
  enough_data: boolean
  recommendation: Recommendation
  daily: ExperimentDay[]
  currency: string | null
  timezone: string | null
}

/** Enough data: at least this many visitors and goal events in each version (the server's rule). */
export const ENOUGH_VISITORS = 100
export const ENOUGH_GOALS = 10

/* ------------------------------------------------------------------------------- readers ----- */

type Raw = Record<string, unknown>
const obj = (value: unknown): Raw => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Raw) : {})

function count(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

function measure(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  return Number.isFinite(n) ? n : null
}

const money = (value: unknown): string => (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim()) ? value.trim() : typeof value === 'number' && Number.isFinite(value) ? String(value) : '0')

function readArm(value: unknown): ArmResult {
  const raw = obj(value)
  const visitors = count(raw.visitors)
  const goal = count(raw.goal_count)
  return {
    visitors,
    views: count(raw.views),
    goal_count: goal,
    rate: visitors > 0 ? (goal / visitors) * 100 : null,
    orders: count(raw.orders),
    revenue: money(raw.revenue),
    add_to_carts: count(raw.add_to_carts),
    clicks: count(raw.clicks),
    section_views: count(raw.section_views),
  }
}

const GOALS: readonly ExperimentGoal[] = ['orders', 'add_to_cart', 'clicks']
const CONFIDENCE: readonly Confidence[] = ['low', 'medium', 'high']
const RECOMMENDATIONS: readonly Recommendation[] = ['keep_a', 'keep_b', 'keep_running']

export function readResults(value: unknown, fallbackGoal: ExperimentGoal = 'orders'): ExperimentResults {
  const raw = obj(value)
  const arms = obj(raw.arms)
  const A = readArm(arms.A)
  const B = readArm(arms.B)
  const daily = Array.isArray(raw.daily) ? raw.daily : []
  const enough = raw.enough_data === true
  let probability = measure(raw.probability_b_beats_a)
  if (probability !== null) probability = Math.min(100, Math.max(0, probability))
  const confidence = CONFIDENCE.includes(raw.confidence as Confidence) ? (raw.confidence as Confidence) : 'low'
  const recommendation = RECOMMENDATIONS.includes(raw.recommendation as Recommendation) ? (raw.recommendation as Recommendation) : 'keep_running'
  return {
    goal: GOALS.includes(raw.goal as ExperimentGoal) ? (raw.goal as ExperimentGoal) : fallbackGoal,
    arms: { A, B },
    lift: measure(raw.lift),
    probability_b_beats_a: probability,
    // Never more than "low" or a pick without enough data, whatever comes.
    confidence: enough ? confidence : 'low',
    enough_data: enough,
    recommendation: enough ? recommendation : 'keep_running',
    daily: daily
      .map(obj)
      .filter((d) => typeof d.day === 'string')
      .map((d) => {
        const a = obj(d.A)
        const b = obj(d.B)
        return { day: d.day as string, A: { visitors: count(a.visitors), goal_count: count(a.goal_count) }, B: { visitors: count(b.visitors), goal_count: count(b.goal_count) } }
      }),
    currency: typeof raw.currency === 'string' ? raw.currency : null,
    timezone: typeof raw.timezone === 'string' ? raw.timezone : null,
  }
}

/* ------------------------------------------------------------------------------- requests ---- */

const doc = (id: string) => `/storefront/builder/documents/${encodeURIComponent(id)}`
const exp = (id: string, experimentId: string) => `${doc(id)}/experiments/${encodeURIComponent(experimentId)}`

export const experimentKeys = {
  all: ['store-builder', 'experiments'] as const,
  results: (documentId: string, experimentId: string, device: ResultsDevice) => ['store-builder', 'experiments', documentId, experimentId, device] as const,
}

export async function fetchExperimentResults(documentId: string, experimentId: string, device: ResultsDevice, goal: ExperimentGoal, signal?: AbortSignal): Promise<ExperimentResults> {
  const response = await api.get<unknown>(`${exp(documentId, experimentId)}/results`, { query: { device: device === 'all' ? undefined : device }, signal })
  return readResults(response.data, goal)
}

export function useExperimentResultsQuery(documentId: string, experimentId: string, device: ResultsDevice, goal: ExperimentGoal, enabled: boolean) {
  return useQuery({
    queryKey: experimentKeys.results(documentId, experimentId, device),
    queryFn: ({ signal }) => fetchExperimentResults(documentId, experimentId, device, goal, signal),
    enabled,
    placeholderData: (previous) => previous,
    // "Live" results: fresh every minute while the panel is open.
    staleTime: 30_000,
    refetchInterval: enabled ? 60_000 : false,
  })
}

export type ExperimentAction = { kind: 'start' } | { kind: 'stop' } | { kind: 'keep'; arm: ExperimentArm }

export function runExperimentAction(documentId: string, experimentId: string, revision: number, action: ExperimentAction): Promise<DocumentDetail> {
  const body: Record<string, unknown> = { revision }
  if (action.kind === 'keep') body.arm = action.arm
  return api.post<DocumentDetail>(`${exp(documentId, experimentId)}/${action.kind}`, body).then((r) => r.data)
}
