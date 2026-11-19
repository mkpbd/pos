import { formatPercent } from '../insights/insights-model'
import { ENOUGH_GOALS, ENOUGH_VISITORS, type Confidence, type ExperimentResults } from './experiments-api'
import { goalWords, type ExperimentGoal } from './experiments-model'

/*
 * B13: A/B test results in plain words for a shop owner — and honest: no "sure" sentence without
 * enough data, never "100 % sure", and a close race is called a close race.
 */

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

/** "96 %", "more than 99 %", "less than 1 %". */
export function sureText(percent: number): string {
  if (percent > 99) return 'more than 99\u00a0%'
  if (percent < 1) return 'less than 1\u00a0%'
  return `${Math.round(percent)}\u00a0%`
}

export function liftText(lift: number): string {
  return formatPercent(Math.abs(lift))
}

/** The one-sentence answer at the top of a test's results. */
export function resultHeadline(results: ExperimentResults, goal: ExperimentGoal): string {
  const words = goalWords(goal)
  const { A, B } = results.arms
  if (A.visitors === 0 && B.visitors === 0) return 'No visitors in the test yet. Results appear once shoppers see the published page.'
  const p = results.probability_b_beats_a
  const lift = results.lift
  if (!results.enough_data) {
    if (A.goal_count === 0 && B.goal_count === 0) return `Too early to tell — neither version has ${words.noun} yet.`
    if (lift === null) return `Too early to tell — so far only version ${A.goal_count > 0 ? 'A' : 'B'} has ${words.noun}.`
    if (Math.abs(lift) < 0.05) return `Too early to tell — both versions get the same share of ${words.noun} so far.`
    return `Too early to tell — so far version B gets ${liftText(lift)} ${lift > 0 ? 'more' : 'fewer'} ${words.noun}, but that can still change.`
  }
  if (lift === null || p === null || Math.abs(lift) < 0.05) return `Both versions get about the same ${words.noun}.`
  const better = lift > 0
  const sure = better ? p : 100 - p
  const sentence = `Version B gets ${liftText(lift)} ${better ? 'more' : 'fewer'} ${words.noun}`
  if (results.confidence === 'low' || sure < 75) return `${sentence}, but it’s a close call: only ${sureText(sure)} sure version ${better ? 'B' : 'A'} is better.`
  return `${sentence} — ${sureText(sure)} sure version ${better ? 'B' : 'A'} is better.`
}

export const CONFIDENCE_WORDS: Record<Confidence, string> = { low: 'Not sure yet', medium: 'Fairly sure', high: 'Very sure' }

export function recommendationText(results: ExperimentResults): string {
  if (!results.enough_data) return 'Keep the test running until there is enough data.'
  switch (results.recommendation) {
    case 'keep_b':
      return 'Our suggestion: keep version B.'
    case 'keep_a':
      return 'Our suggestion: keep version A — version B didn’t do better.'
    default:
      return 'Our suggestion: keep the test running — the two versions are still too close to call.'
  }
}

/** 0–1: how far the test is towards enough data (the version furthest behind counts). */
export function dataProgress(results: ExperimentResults): number {
  const of = (arm: { visitors: number; goal_count: number }) => Math.min(1, arm.visitors / ENOUGH_VISITORS, arm.goal_count / ENOUGH_GOALS)
  return results.enough_data ? 1 : Math.max(0, Math.min(of(results.arms.A), of(results.arms.B), 0.99))
}

export function progressText(results: ExperimentResults, goal: ExperimentGoal): string {
  const words = goalWords(goal)
  if (results.enough_data) return 'There’s enough data to decide.'
  const arm = (key: 'A' | 'B') => `version ${key} has ${plural(results.arms[key].visitors, 'visitor', 'visitors')} and ${plural(results.arms[key].goal_count, words.one, words.noun)}`
  return `Each version needs at least ${ENOUGH_VISITORS} visitors and ${ENOUGH_GOALS} ${words.noun}. Now ${arm('A')}; ${arm('B')}.`
}

/** The rate a version reached ("3.1 % of visitors ordered"). */
export function rateText(rate: number | null, goal: ExperimentGoal): string {
  return rate === null ? 'No visitors yet' : `${formatPercent(rate)} ${goalWords(goal).rateWords}`
}

/** Each day: the share of the version's visitors so far who reached the goal (running totals; 0–100). */
export function cumulativeRates(daily: ExperimentResults['daily']): { day: string; A: number | null; B: number | null }[] {
  const sum = { A: { v: 0, g: 0 }, B: { v: 0, g: 0 } }
  return daily.map((d) => {
    for (const key of ['A', 'B'] as const) {
      sum[key].v += d[key].visitors
      sum[key].g += d[key].goal_count
    }
    return { day: d.day, A: sum.A.v > 0 ? (sum.A.g / sum.A.v) * 100 : null, B: sum.B.v > 0 ? (sum.B.g / sum.B.v) * 100 : null }
  })
}
