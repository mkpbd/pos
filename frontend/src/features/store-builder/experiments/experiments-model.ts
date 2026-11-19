import type { BuilderContent, Experiment, ExperimentArm, ExperimentGoal, ExperimentStatus, RenderSection, Section, SectionExperiment } from '@/storefront/builder/types'
import { MAX_EXPERIMENTS } from '@/storefront/builder/audience/types'
import type { DocumentKind } from '../api'
import { isGlobalRef } from '../global-sections'
import { cloneWithFreshIds, collectIds, findNode, newId } from '../tree'

/*
 * B13 A/B tests in the draft (pure). A document keeps `experiments[]`; the sections of a test carry
 * `experiment {id, arm}` and sit next to each other on the page (one block: version A's sections,
 * then version B's, each 1–3). Status, start / end dates and the winner are the server's — the
 * editor only adds new tests as drafts and changes the name, goal and split; start / stop / keep
 * are server actions (./experiments-api.ts).
 */

export type { Experiment, ExperimentArm, ExperimentGoal, ExperimentStatus, SectionExperiment }

/** Sections per version. */
export const MAX_ARM_SECTIONS = 3
export const SPLIT_MIN = 10
export const SPLIT_MAX = 90
export const SPLIT_STEP = 5
export const NAME_MAX = 60

/** Documents that can hold A/B tests (pages, CMS pages and shop areas). */
export function canHaveExperiments(kind: DocumentKind): boolean {
  return kind === 'page' || kind === 'zone'
}

export function experimentsOf(content: BuilderContent): Experiment[] {
  return Array.isArray(content.experiments) ? content.experiments : []
}

export function findExperiment(content: BuilderContent, id: string): Experiment | null {
  return experimentsOf(content).find((e) => e.id === id) ?? null
}

/** A section's arm (null: not in a test). */
export function armOf(node: unknown): SectionExperiment | null {
  const value = (node as { experiment?: unknown } | null | undefined)?.experiment
  if (typeof value !== 'object' || value === null) return null
  const { id, arm } = value as { id?: unknown; arm?: unknown }
  return typeof id === 'string' && (arm === 'A' || arm === 'B') ? { id, arm } : null
}

export type ArmSections = Record<ExperimentArm, string[]>

/** The section ids of each version of a test, in page order. */
export function armSections(content: BuilderContent, experimentId: string): ArmSections {
  const out: ArmSections = { A: [], B: [] }
  for (const section of content.sections) {
    const arm = armOf(section)
    if (arm?.id === experimentId) out[arm.arm].push(section.id)
  }
  return out
}

/** Section id → its test and version (tests that exist in `experiments[]` only). */
export function armIndex(content: BuilderContent): Map<string, SectionExperiment> {
  const known = new Set(experimentsOf(content).map((e) => e.id))
  const out = new Map<string, SectionExperiment>()
  for (const section of content.sections) {
    const arm = armOf(section)
    if (arm && known.has(arm.id)) out.set(section.id, arm)
  }
  return out
}

/** The version the editor shows when nothing else is picked: the winner of a finished / stopped test, else A. */
export function defaultArm(experiment: Experiment | null): ExperimentArm {
  return experiment && (experiment.status === 'stopped' || experiment.status === 'ended') && experiment.winner ? experiment.winner : 'A'
}

/** Why a section can't get a test now (null: it can). */
export function testReason(content: BuilderContent, sectionId: string, options: { kind: DocumentKind; single?: boolean }): string | null {
  if (!canHaveExperiments(options.kind) || options.single) return 'A/B tests are for pages and shop areas.'
  const index = content.sections.findIndex((s) => s.id === sectionId)
  if (index < 0) return 'Pick a section of the page.'
  const section = content.sections[index]
  if (isGlobalRef(section)) return 'Global sections can’t be tested here. Detach it first, then test the copy.'
  if (armOf(section)) return 'This section is already in an A/B test.'
  if (experimentsOf(content).length >= MAX_EXPERIMENTS) return `A page can have up to ${MAX_EXPERIMENTS} A/B tests. Remove a finished one first.`
  return null
}

/** "Test 2" — the first free number. */
export function nextTestName(content: BuilderContent, base = 'Test'): string {
  const names = new Set(experimentsOf(content).map((e) => e.name))
  for (let n = 1; ; n++) {
    const name = n === 1 && base !== 'Test' ? base : `${base} ${n}`
    if (!names.has(name)) return name
  }
}

/**
 * "Test a different version": the section becomes version A, a copy right after it version B, and
 * a draft test is added (orders, 50 / 50). One edit = one undo step. Null when it can't be done.
 */
export function createTest(content: BuilderContent, sectionId: string, name: string): { content: BuilderContent; experimentId: string; copyId: string } | null {
  const index = content.sections.findIndex((s) => s.id === sectionId)
  const section = content.sections[index]
  if (!section || isGlobalRef(section) || armOf(section) || experimentsOf(content).length >= MAX_EXPERIMENTS) return null
  const existing = collectIds(content)
  for (const e of experimentsOf(content)) existing.add(e.id)
  const experimentId = newId('ab', existing)
  const copy = cloneWithFreshIds(section as Section, existing)
  const original: Section = { ...(section as Section), experiment: { id: experimentId, arm: 'A' } }
  const variant: Section = { ...copy, experiment: { id: experimentId, arm: 'B' } }
  const sections = [...content.sections]
  sections.splice(index, 1, original, variant)
  const experiment: Experiment = { id: experimentId, name: name.slice(0, NAME_MAX), status: 'draft', goal: 'orders', split: 50, started_at: null, ended_at: null, winner: null }
  return { content: { ...content, sections, experiments: [...experimentsOf(content), experiment] }, experimentId, copyId: variant.id }
}

export type ExperimentPatch = Partial<Pick<Experiment, 'name' | 'goal' | 'split'>>

/** Changes what the owner may change (name, goal, split); the rest is the server's. */
export function updateExperiment(content: BuilderContent, id: string, patch: ExperimentPatch): BuilderContent {
  const list = experimentsOf(content)
  const current = list.find((e) => e.id === id)
  if (!current) return content
  const next: Experiment = { ...current }
  if (patch.name !== undefined) next.name = patch.name.slice(0, NAME_MAX)
  if (patch.goal !== undefined) next.goal = patch.goal
  if (patch.split !== undefined) next.split = clampSplit(patch.split)
  if (next.name === current.name && next.goal === current.goal && next.split === current.split) return content
  return { ...content, experiments: list.map((e) => (e.id === id ? next : e)) }
}

export function clampSplit(value: number): number {
  if (!Number.isFinite(value)) return 50
  const stepped = Math.round(value / SPLIT_STEP) * SPLIT_STEP
  return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, stepped))
}

/**
 * Takes a test off the page without the server (a test that never ran, or a finished one): `keep`'s
 * sections stay as plain sections, the other version's sections are deleted (with their phone /
 * tablet order entries), and the test leaves the list. One undo step.
 */
export function removeTest(content: BuilderContent, id: string, keep: ExperimentArm = 'A'): BuilderContent {
  if (!findExperiment(content, id)) return content
  const dropped = new Set<string>()
  const sections = content.sections.flatMap((section) => {
    const arm = armOf(section)
    if (arm?.id !== id) return [section]
    if (arm.arm !== keep) {
      dropped.add(section.id)
      return []
    }
    const { experiment: _experiment, ...rest } = section as Section
    return [rest as Section]
  })
  const experiments = experimentsOf(content).filter((e) => e.id !== id)
  const next: BuilderContent = { ...content, sections, experiments }
  if (experiments.length === 0) delete next.experiments
  if (content.device_order && dropped.size > 0) next.device_order = withoutIds(content.device_order, dropped)
  return next
}

function withoutIds(order: NonNullable<BuilderContent['device_order']>, ids: Set<string>): NonNullable<BuilderContent['device_order']> {
  const out: NonNullable<BuilderContent['device_order']> = {}
  for (const device of ['tablet', 'mobile'] as const) {
    const map = order[device]
    if (!map) continue
    out[device] = Object.fromEntries(Object.entries(map).map(([container, list]) => [container, list.filter((id) => !ids.has(id))]))
  }
  return out
}

/** What is wrong with a test's sections, in plain words (empty: nothing). */
export function experimentProblems(content: BuilderContent, id: string): string[] {
  const problems: string[] = []
  const arms = armSections(content, id)
  if (arms.A.length === 0) problems.push('Version A has no sections. Undo, or remove the test.')
  if (arms.B.length === 0) problems.push('Version B has no sections. Undo, or remove the test.')
  for (const arm of ['A', 'B'] as const) if (arms[arm].length > MAX_ARM_SECTIONS) problems.push(`Version ${arm} has ${arms[arm].length} sections; ${MAX_ARM_SECTIONS} is the most.`)
  // One block: every section between the first and the last belongs to the test.
  const positions = content.sections.map((s, i) => (armOf(s)?.id === id ? i : -1)).filter((i) => i >= 0)
  if (positions.length > 1 && positions[positions.length - 1]! - positions[0]! + 1 !== positions.length) problems.push('The versions must sit next to each other on the page. Move the other sections out from between them.')
  return problems
}

/** Can the server start it: both versions have sections and nothing is wrong. */
export function startReason(content: BuilderContent, experiment: Experiment): string | null {
  if (experiment.status === 'running') return 'The test is already running.'
  if (experiment.status === 'ended') return 'This test is finished.'
  const problems = experimentProblems(content, experiment.id)
  return problems[0] ?? null
}

/**
 * The canvas shows one version of each test: the sections of the other version are left out.
 * `shown` is the editor's pick per test (default: defaultArm). Sections of unknown tests stay.
 */
export function showArms<S extends Pick<RenderSection, 'id'>>(sections: S[], content: BuilderContent, shown: Readonly<Record<string, ExperimentArm>>): S[] {
  const index = armIndex(content)
  if (index.size === 0) return sections
  const pick = (id: string) => shown[id] ?? defaultArm(findExperiment(content, id))
  const out = sections.filter((section) => {
    const arm = index.get(section.id)
    return !arm || arm.arm === pick(arm.id)
  })
  return out.length === sections.length ? sections : out
}

/** The test version the node `id` is in (its section's), or null. */
export function armOfNode(content: BuilderContent, id: string | null): SectionExperiment | null {
  if (!id) return null
  const info = findNode(content, id)
  const sectionId = info?.sectionId ?? (content.sections.some((s) => s.id === id) ? id : null)
  if (!sectionId) return null
  const arm = armIndex(content).get(sectionId)
  return arm ?? null
}

/** The shown version of each test: the pick, else the one holding the selection, else the default. */
export function shownArms(content: BuilderContent, picked: Readonly<Record<string, ExperimentArm>>, selection: string | null): Record<string, ExperimentArm> {
  const out: Record<string, ExperimentArm> = {}
  for (const e of experimentsOf(content)) out[e.id] = picked[e.id] ?? defaultArm(e)
  const selected = armOfNode(content, selection)
  if (selected) out[selected.id] = selected.arm
  return out
}

/* ------------------------------------------------------------------------------- words ------- */

export const GOALS: { value: ExperimentGoal; label: string; noun: string; one: string; rateWords: string; did: string }[] = [
  { value: 'orders', label: 'Orders', noun: 'orders', one: 'order', rateWords: 'of visitors ordered', did: 'ordered' },
  { value: 'add_to_cart', label: 'Adds to cart', noun: 'adds to cart', one: 'add to cart', rateWords: 'of visitors added something to the cart', did: 'added something to the cart' },
  { value: 'clicks', label: 'Clicks in the section', noun: 'clicks', one: 'click', rateWords: 'of visitors clicked in the section', did: 'clicked in the section' },
]

export function goalWords(goal: ExperimentGoal) {
  return GOALS.find((g) => g.value === goal) ?? GOALS[0]!
}

export const STATUS_WORDS: Record<ExperimentStatus, string> = { draft: 'Not started', running: 'Running', stopped: 'Stopped', ended: 'Finished' }
