import { cloneSample } from '@/storefront/builder/test-payload'
import type { BuilderContent, Experiment, RenderSection, Section } from '@/storefront/builder/types'
import { readResults, type ExperimentResults } from './experiments-api'
import {
  armIndex,
  armSections,
  clampSplit,
  createTest,
  experimentProblems,
  experimentsOf,
  removeTest,
  showArms,
  shownArms,
  startReason,
  testReason,
  updateExperiment,
} from './experiments-model'
import { cumulativeRates, dataProgress, progressText, recommendationText, resultHeadline, sureText } from './results-words'
import { testNameFor } from './test-name'

/* B13 editor B: A/B tests in the draft (pure) and the results in plain words. */

const ids = (content: BuilderContent) => content.sections.map((s) => s.id)

function withTest(): { content: BuilderContent; experimentId: string; copyId: string } {
  const result = createTest(cloneSample(), 's_story', 'Story test')
  if (!result) throw new Error('no test')
  return result
}

function results(input: Record<string, unknown>): ExperimentResults {
  return readResults(input, 'orders')
}

/** The panel's words use a no-break space before %. */
const nb = (text: string) => text.replace(/ %/g, '\u00a0%')
const arm = (visitors: number, goal: number) => ({ visitors, goal_count: goal, orders: goal, revenue: '1500.00', views: visitors, add_to_carts: 0, clicks: 0, section_views: visitors })

describe('A/B tests in the draft', () => {
  it('"Test a different version" puts a copy right after the section as version B and adds a draft test', () => {
    const before = cloneSample()
    const { content, experimentId, copyId } = withTest()
    expect(ids(content)).toEqual(['s_hero', 's_story', copyId, 's_features', 's_products', 's_hidden'])
    expect(experimentId).toMatch(/^[a-z][a-z0-9_-]{1,31}$/)
    expect(experimentsOf(content)).toEqual([{ id: experimentId, name: 'Story test', status: 'draft', goal: 'orders', split: 50, started_at: null, ended_at: null, winner: null }])
    expect(armSections(content, experimentId)).toEqual({ A: ['s_story'], B: [copyId] })
    // The copy has fresh ids everywhere and the same content.
    const copy = content.sections[2] as Section
    expect(copy.columns[0]!.id).not.toBe((before.sections[1] as Section).columns[0]!.id)
    expect(copy.columns[0]!.elements.length).toBe((before.sections[1] as Section).columns[0]!.elements.length)
    // The input is untouched (one apply = one undo step).
    expect(ids(before)).toEqual(['s_hero', 's_story', 's_features', 's_products', 's_hidden'])
  })

  it('says why a section can’t be tested', () => {
    const { content } = withTest()
    expect(testReason(content, 's_story', { kind: 'page' })).toMatch(/already in an A\/B test/)
    expect(testReason(content, 's_hero', { kind: 'popup' })).toMatch(/pages and shop areas/)
    expect(testReason(content, 's_hero', { kind: 'page', single: true })).toMatch(/pages and shop areas/)
    expect(testReason(content, 's_hero', { kind: 'page' })).toBeNull()
    const global = { ...content, sections: [...content.sections, { id: 'g_ref', type: 'global_section', ref: 'glob-1', hidden: false, schedule: null }] } as unknown as BuilderContent
    expect(testReason(global, 'g_ref', { kind: 'page' })).toMatch(/Global sections/)
    let three = cloneSample()
    for (const id of ['s_hero', 's_story', 's_features']) three = createTest(three, id, 'T')!.content
    expect(experimentsOf(three)).toHaveLength(3)
    expect(createTest(three, three.sections[1]!.id, 'more')).toBeNull()
  })

  it('names tests after what the section starts with, without repeats', () => {
    const content = cloneSample()
    const name = testNameFor(content, 's_story')
    expect(name).toMatch(/ test$/)
    const next = createTest(content, 's_story', name)!.content
    expect(testNameFor(next, 's_features')).not.toBe(name)
  })

  it('changes the name, goal and split only; the split stays 10–90 in steps of 5', () => {
    const { content, experimentId } = withTest()
    const next = updateExperiment(content, experimentId, { split: 33, goal: 'add_to_cart', name: 'Hero' })
    expect(experimentsOf(next)[0]).toMatchObject({ split: 35, goal: 'add_to_cart', name: 'Hero', status: 'draft' })
    expect(updateExperiment(next, experimentId, { split: 35 })).toBe(next)
    expect(clampSplit(2)).toBe(10)
    expect(clampSplit(99)).toBe(90)
  })

  it('removing a test keeps one version as plain sections (and drops the other one’s phone order)', () => {
    const { content, experimentId, copyId } = withTest()
    const ordered = { ...content, device_order: { mobile: { root: ['s_features', copyId, 's_story', 's_hero'] } } }
    const keptA = removeTest(ordered, experimentId, 'A')
    expect(ids(keptA)).toEqual(['s_hero', 's_story', 's_features', 's_products', 's_hidden'])
    expect(keptA.experiments).toBeUndefined()
    expect((keptA.sections[1] as Section).experiment).toBeUndefined()
    expect(keptA.device_order?.mobile?.root).toEqual(['s_features', 's_story', 's_hero'])
    const keptB = removeTest(content, experimentId, 'B')
    expect(ids(keptB)).toEqual(['s_hero', copyId, 's_features', 's_products', 's_hidden'])
  })

  it('finds problems: an empty version, versions apart, too many sections', () => {
    const { content, experimentId, copyId } = withTest()
    expect(experimentProblems(content, experimentId)).toEqual([])
    const noB = { ...content, sections: content.sections.filter((s) => s.id !== copyId) }
    expect(experimentProblems(noB, experimentId)).toEqual([expect.stringMatching(/Version B has no sections/)])
    const experiment = experimentsOf(noB)[0]!
    expect(startReason(noB, experiment)).toMatch(/Version B/)
    const apart = { ...content, sections: [content.sections[1]!, content.sections[0]!, ...content.sections.slice(2)] }
    expect(experimentProblems(apart, experimentId).join(' ')).toMatch(/next to each other/)
    expect(startReason(content, { ...experiment, status: 'running' })).toMatch(/already running/)
  })

  it('the canvas draws one version: the pick, else the selection’s, else A (the winner when stopped)', () => {
    const { content, experimentId, copyId } = withTest()
    const sections = content.sections.map((s) => ({ id: s.id })) as RenderSection[]
    expect(showArms(sections, content, shownArms(content, {}, null)).map((s) => s.id)).toEqual(['s_hero', 's_story', 's_features', 's_products', 's_hidden'])
    expect(showArms(sections, content, shownArms(content, { [experimentId]: 'B' }, null)).map((s) => s.id)).toEqual(['s_hero', copyId, 's_features', 's_products', 's_hidden'])
    // Something inside version A is selected: A is shown whatever was picked.
    const inA = (content.sections[1] as Section).columns[0]!.elements[0]!.id
    expect(shownArms(content, { [experimentId]: 'B' }, inA)[experimentId]).toBe('A')
    const stopped: BuilderContent = { ...content, experiments: experimentsOf(content).map((e): Experiment => ({ ...e, status: 'stopped', winner: 'B' })) }
    expect(shownArms(stopped, {}, null)[experimentId]).toBe('B')
    // No tests: the same array.
    const plain = cloneSample()
    const list = plain.sections.map((s) => ({ id: s.id })) as RenderSection[]
    expect(showArms(list, plain, {})).toBe(list)
    expect(armIndex(plain).size).toBe(0)
  })
})

describe('A/B test results in plain words', () => {
  it('reads the server’s results and never claims more than “low” without enough data', () => {
    const r = results({ arms: { A: arm(40, 2), B: arm(42, 4) }, lift: '90.48', probability_b_beats_a: '81.20', confidence: 'high', enough_data: false, recommendation: 'keep_b', daily: [] })
    expect(r.confidence).toBe('low')
    expect(r.recommendation).toBe('keep_running')
    expect(r.arms.A.rate).toBeCloseTo(5)
    expect(r.lift).toBeCloseTo(90.48)
    expect(r.probability_b_beats_a).toBeCloseTo(81.2)
  })

  it('says it plainly and honestly', () => {
    expect(resultHeadline(results({ arms: { A: arm(0, 0), B: arm(0, 0) } }), 'orders')).toMatch(/No visitors in the test yet/)
    expect(resultHeadline(results({ arms: { A: arm(40, 2), B: arm(42, 4) }, lift: '90.48', probability_b_beats_a: '81.2', enough_data: false }), 'orders')).toBe(
      nb('Too early to tell — so far version B gets 90 % more orders, but that can still change.'),
    )
    const sure = results({ arms: { A: arm(1200, 40), B: arm(1180, 48) }, lift: '23.4', probability_b_beats_a: '96.12', confidence: 'high', enough_data: true, recommendation: 'keep_b' })
    expect(resultHeadline(sure, 'orders')).toBe(nb('Version B gets 23 % more orders — 96 % sure version B is better.'))
    expect(recommendationText(sure)).toBe('Our suggestion: keep version B.')
    const worse = results({ arms: { A: arm(1200, 48), B: arm(1180, 36) }, lift: '-23.7', probability_b_beats_a: '3.5', confidence: 'high', enough_data: true, recommendation: 'keep_a' })
    expect(resultHeadline(worse, 'add_to_cart')).toBe(nb('Version B gets 24 % fewer adds to cart — 97 % sure version A is better.'))
    const close = results({ arms: { A: arm(1200, 40), B: arm(1200, 42) }, lift: '5', probability_b_beats_a: '62', confidence: 'low', enough_data: true, recommendation: 'keep_running' })
    expect(resultHeadline(close, 'orders')).toMatch(/close call: only 62\u00a0% sure/)
    expect(recommendationText(close)).toMatch(/too close to call/)
    expect(sureText(99.7)).toBe(nb('more than 99 %'))
    expect(sureText(0.2)).toBe(nb('less than 1 %'))
  })

  it('shows the way to enough data (the version furthest behind counts)', () => {
    const r = results({ arms: { A: arm(80, 4), B: arm(120, 12) }, enough_data: false })
    expect(dataProgress(r)).toBeCloseTo(0.4)
    expect(progressText(r, 'orders')).toBe('Each version needs at least 100 visitors and 10 orders. Now version A has 80 visitors and 4 orders; version B has 120 visitors and 12 orders.')
    expect(dataProgress(results({ arms: { A: arm(200, 20), B: arm(200, 20) }, enough_data: true }))).toBe(1)
  })

  it('works out each day’s running rate per version', () => {
    const daily = readResults({
      daily: [
        { day: '2026-11-01', A: { visitors: 10, goal_count: 1 }, B: { visitors: 0, goal_count: 0 } },
        { day: '2026-11-02', A: { visitors: 10, goal_count: 1 }, B: { visitors: 20, goal_count: 3 } },
      ],
    }).daily
    expect(cumulativeRates(daily)).toEqual([
      { day: '2026-11-01', A: 10, B: null },
      { day: '2026-11-02', A: 10, B: 15 },
    ])
  })
})
