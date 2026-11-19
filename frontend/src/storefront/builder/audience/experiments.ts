import type { ExperimentArm, ExperimentArms, ExperimentStatus } from './types'

/*
 * B13 §2 A/B tests on the live store. The payload sends every arm's sections; the browser shows one
 * arm per experiment:
 * - running: the visitor's arm — drawn at random by the split (B %) on the first view and kept in
 *   localStorage `sf.ab.<document>.<experiment>` (sticky; a memory copy when storage is blocked);
 * - draft: A; stopped / ended: the winner, else A;
 * - Do Not Track / Global Privacy Control: always A, nothing stored, no arm sent anywhere.
 * Only running experiments' arms are reported (beacons `arms`, order `attribution.builder.experiments`).
 */

/** What the renderer needs of an experiment (published payloads carry `{id, status, split, winner}`). */
export type ExperimentView = { id: string; status: ExperimentStatus; split: number; winner: ExperimentArm | null }

const EXPERIMENT_ID = /^[a-z][a-z0-9_-]{1,31}$/
const STATUSES: readonly ExperimentStatus[] = ['draft', 'running', 'stopped', 'ended']
const MAX = 3

export const AB_STORAGE_PREFIX = 'sf.ab.'

const isArm = (value: unknown): value is ExperimentArm => value === 'A' || value === 'B'

/** A payload's `experiments`, checked (unknown status = draft; split clamped to 0–100, default 50). */
export function readExperiments(value: unknown): ExperimentView[] {
  if (!Array.isArray(value)) return []
  const out: ExperimentView[] = []
  for (const item of value) {
    if (out.length >= MAX) break
    if (typeof item !== 'object' || item === null) continue
    const raw = item as Record<string, unknown>
    if (typeof raw.id !== 'string' || !EXPERIMENT_ID.test(raw.id) || out.some((e) => e.id === raw.id)) continue
    const split = typeof raw.split === 'number' && Number.isFinite(raw.split) ? Math.min(100, Math.max(0, raw.split)) : 50
    out.push({
      id: raw.id,
      status: STATUSES.includes(raw.status as ExperimentStatus) ? (raw.status as ExperimentStatus) : 'draft',
      split,
      winner: isArm(raw.winner) ? raw.winner : null,
    })
  }
  return out
}

/** The arm everyone sees when no visitor arm applies: the winner of a stopped / ended test, else A. */
export function defaultArm(experiment: Pick<ExperimentView, 'status' | 'winner'>): ExperimentArm {
  return (experiment.status === 'stopped' || experiment.status === 'ended') && experiment.winner ? experiment.winner : 'A'
}

/** A new visitor's arm: B with probability split %. `random` in [0, 1). */
export function drawArm(split: number, random: number): ExperimentArm {
  return random * 100 < split ? 'B' : 'A'
}

export const abStorageKey = (documentId: string, experimentId: string) => `${AB_STORAGE_PREFIX}${documentId}.${experimentId}`

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/** Arms kept in memory when storage is blocked (stable for this page load). */
const memory = new Map<string, ExperimentArm>()

/** Test hook: forget the in-memory arms. */
export function resetMemoryArms(): void {
  memory.clear()
}

export type AssignOptions = {
  /** The visitor refused tracking (DNT / GPC): everyone gets the default arm and nothing is stored. */
  refused: boolean
  random?: () => number
}

/** The visitor's sticky arm of a running experiment (drawn and stored on the first call). */
export function stickyArm(documentId: string, experiment: ExperimentView, random: () => number = Math.random): ExperimentArm {
  const key = abStorageKey(documentId, experiment.id)
  const store = storage()
  try {
    const stored = store?.getItem(key)
    if (isArm(stored)) return stored
  } catch {
    // Blocked storage: the memory copy below.
  }
  const remembered = memory.get(key)
  if (remembered) return remembered
  const arm = drawArm(experiment.split, random())
  memory.set(key, arm)
  try {
    store?.setItem(key, arm)
  } catch {
    // Kept in memory only.
  }
  return arm
}

/** The arm shown for an experiment on the live store. */
export function armFor(documentId: string, experiment: ExperimentView, options: AssignOptions): ExperimentArm {
  if (experiment.status !== 'running' || options.refused) return defaultArm(experiment)
  return stickyArm(documentId, experiment, options.random)
}

export type ArmPlan = {
  /** The arm drawn for every experiment of the payload. */
  shown: ExperimentArms
  /** What is reported (running experiments only; empty when tracking was refused). */
  reported: ExperimentArms
}

/** The arms of a document's experiments for this visitor. `documentId` null (no published id): defaults only. */
export function planArms(documentId: string | null, experiments: readonly ExperimentView[], options: AssignOptions): ArmPlan {
  const shown: ExperimentArms = {}
  const reported: ExperimentArms = {}
  for (const experiment of experiments) {
    const arm = documentId ? armFor(documentId, experiment, options) : defaultArm(experiment)
    shown[experiment.id] = arm
    if (documentId && experiment.status === 'running' && !options.refused) reported[experiment.id] = arm
  }
  return { shown, reported }
}

/** Whether a section is drawn for these arms: a section of another arm is not; one without a (known) experiment always is. */
export function sectionInArm(section: { experiment?: unknown }, shown: ExperimentArms): boolean {
  const tag = section.experiment
  if (typeof tag !== 'object' || tag === null) return true
  const { id, arm } = tag as Record<string, unknown>
  if (typeof id !== 'string' || !Object.hasOwn(shown, id) || !isArm(arm)) return true
  return shown[id] === arm
}

/* ----------------------------------------------------------------------------------------------
 * The arms reported for each published document shown on this page load, for order attribution.
 * -------------------------------------------------------------------------------------------- */

const reportedByDocument = new Map<string, ExperimentArms>()

/** Keeps the reported arms of a document drawn on the store (empty = forget it). */
export function rememberReportedArms(documentId: string, arms: ExperimentArms): void {
  if (Object.keys(arms).length === 0) reportedByDocument.delete(documentId)
  else reportedByDocument.set(documentId, { ...arms })
}

/** The running experiments' arms of a document shown on this page load (null = none). */
export function reportedArmsOf(documentId: string): ExperimentArms | null {
  const arms = reportedByDocument.get(documentId)
  return arms && Object.keys(arms).length > 0 ? { ...arms } : null
}

/** Test hook. */
export function resetReportedArms(): void {
  reportedByDocument.clear()
}

/** Arms as sent to the server: valid ids and arms only, at most three; null when empty. */
export function cleanArms(value: unknown): ExperimentArms | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const out: ExperimentArms = {}
  for (const [id, arm] of Object.entries(value as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX) break
    if (EXPERIMENT_ID.test(id) && isArm(arm)) out[id] = arm
  }
  return Object.keys(out).length > 0 ? out : null
}
