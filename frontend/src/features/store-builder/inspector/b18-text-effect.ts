/*
 * B18 text effects (contract §1 / §3), the pure part: which elements have one (heading, text and
 * the call to action's title), the sparse `props.text_effect` the form writes, the rotating words
 * and their Bangla translations (`translations.bn["text_effect.words.<i>"]`, kept in step when a
 * word is removed or moved), the length rules and the card hover elements.
 */

import type { CardHover, TextEffect, TextEffectColorRole, TextEffectSpeed, TextEffectType } from '@/storefront/builder/types'
import { B18_ENUMS, B18_LIMITS, plainTextOf, textEffectSource } from '@/storefront/builder/validate'
import type { TranslationField } from '@/features/translations/translations'
import type { Translations } from './bangla'

/** Elements with a text effect (B18_ENUMS.textEffectElements) and the prop it animates. */
export const TEXT_EFFECT_FIELDS: Readonly<Record<string, string>> = { heading: 'text', text: 'html', cta: 'title' }
export const hasTextEffect = (type: string) => (B18_ENUMS.textEffectElements as readonly string[]).includes(type)

/** Backend limits (`limits.text_effect`), page-check thresholds included. */
export const TEXT_EFFECT_LIMITS = {
  words: B18_LIMITS.textEffectWords,
  wordMax: B18_LIMITS.textEffectWordLength,
  revealLettersMax: B18_LIMITS.revealLettersMax,
  cycles: B18_LIMITS.textEffectCycles,
  /** Page check TEXT_EFFECT_LONG: a rotating word longer than this is hard to read. */
  longWord: 24,
  /** Page check TEXT_EFFECT_LONG: typing more than this takes too long. */
  longTypewriter: 160,
} as const

export const TEXT_EFFECT_TYPES: readonly TextEffectType[] = B18_ENUMS.textEffect

export const TEXT_EFFECT_LABELS: Record<TextEffectType, string> = {
  none: 'None',
  typewriter: 'Typewriter',
  rotate_words: 'Rotating words',
  reveal_words: 'Word by word',
  reveal_letters: 'Letter by letter',
  gradient_shimmer: 'Shimmer',
  highlight_draw: 'Highlight',
  underline_draw: 'Underline',
}

export const TEXT_EFFECT_HINTS: Record<TextEffectType, string> = {
  none: 'The text just shows.',
  typewriter: 'The text is typed out, letter by letter.',
  rotate_words: 'Words you choose take turns right after the text, e.g. “Fresh mango”, then “Fresh lychee”.',
  reveal_words: 'The words appear one after another.',
  reveal_letters: 'The letters appear one after another (short texts only).',
  gradient_shimmer: 'A band of colour moves across the letters.',
  highlight_draw: 'A marker colour is drawn behind the text.',
  underline_draw: 'A line is drawn under the text.',
}

export const SPEED_LABELS: Record<TextEffectSpeed, string> = { slow: 'Slow', normal: 'Normal', fast: 'Fast' }
export const COLOR_ROLE_LABELS: Record<TextEffectColorRole, string> = { primary: 'Main colour', accent: 'Accent colour', secondary: 'Second colour' }

/** Effects that use a theme colour role. */
export const usesColorRole = (type: TextEffectType) => type === 'gradient_shimmer' || type === 'highlight_draw' || type === 'underline_draw'
/** Effects that can repeat (cycles). */
export const usesCycles = (type: TextEffectType) => type === 'typewriter' || type === 'rotate_words'

/** `cycles`: a number, "until paused" (null) or the default (absent: typewriter once, rotating words until paused). */
export type CyclesChoice = number | null | 'default'

export type TextEffectState = { type: TextEffectType; words: string[]; speed: TextEffectSpeed; color_role: TextEffectColorRole; cycles: CyclesChoice }

export function textEffectState(value: TextEffect | null | undefined): TextEffectState {
  return {
    type: value?.type ?? 'none',
    words: Array.isArray(value?.words) ? [...value.words] : [],
    speed: value?.speed ?? 'normal',
    color_role: value?.color_role ?? 'primary',
    cycles: value === null || value === undefined || !('cycles' in value) || value.cycles === undefined ? 'default' : value.cycles,
  }
}

/** The effective number of runs (null = until paused). */
export function effectiveCycles(state: TextEffectState): number | null {
  if (state.cycles !== 'default') return state.cycles
  return state.type === 'rotate_words' ? null : 1
}

/**
 * The stored prop (key order as the server's): undefined for "none" (the prop is removed); words
 * only for rotating words; speed only when not normal; the colour role only for the effects that
 * draw one and when not the main colour; cycles only for typewriter / rotating words when chosen.
 */
export function toTextEffect(state: TextEffectState): TextEffect | undefined {
  if (state.type === 'none') return undefined
  const effect: TextEffect = { type: state.type }
  if (state.type === 'rotate_words') effect.words = state.words.length > 0 ? state.words : ['']
  if (state.speed !== 'normal') effect.speed = state.speed
  if (usesColorRole(state.type) && state.color_role !== 'primary') effect.color_role = state.color_role
  if (usesCycles(state.type) && state.cycles !== 'default') effect.cycles = state.cycles
  return effect
}

/** The animated text as the server counts it (a text element's html as plain text). */
export function effectText(type: string, props: unknown): string {
  return textEffectSource(type, props)
}

/** A translated text (a text element's html as plain text), as the server counts it. */
export function effectTextOf(type: string, value: string): string {
  return type === 'text' ? plainTextOf(value) : value
}

/** Counted as the server counts (code points, so a Bangla conjunct counts its parts). */
export const charCount = (text: string) => [...text].length

/** Letter by letter is for short texts: why it can't be chosen now (null = it can). */
export function revealLettersBlocked(text: string, bangla: string | null): string | null {
  const max = TEXT_EFFECT_LIMITS.revealLettersMax
  if (charCount(text) > max) return `Letter by letter is for short texts (at most ${max} characters; this one has ${charCount(text)}).`
  if (bangla && charCount(bangla) > max) return `Letter by letter is for short texts: the Bangla text has ${charCount(bangla)} characters (at most ${max}).`
  return null
}

/* ----------------------------------------------------------------------------------------------
 * Rotating words and their Bangla translations
 * -------------------------------------------------------------------------------------------- */

export const wordKey = (index: number) => `text_effect.words.${index}`
const WORD_KEY = /^text_effect\.words\.(\d+)$/

/** The Bangla translations with the word keys rebuilt from `order` (old index per new position; -1 = a new word). */
function reorderBangla(translations: Translations, order: number[]): Translations {
  const bn = { ...(translations.bn ?? {}) }
  const old: Record<number, string> = {}
  for (const [key, value] of Object.entries(bn)) {
    const m = WORD_KEY.exec(key)
    if (!m) continue
    old[Number(m[1])] = value
    delete bn[key]
  }
  order.forEach((from, to) => {
    const text = from >= 0 ? old[from] : undefined
    if (text) bn[wordKey(to)] = text
  })
  const next = { ...translations }
  if (Object.keys(bn).length > 0) next.bn = bn
  else delete next.bn
  return next
}

/** The Bangla fields of the rotating words (added to the element's Bangla section). */
export function textEffectBanglaFields(effect: TextEffect | undefined): TranslationField[] {
  if (effect?.type !== 'rotate_words') return []
  return (effect.words ?? []).map((word, i) => ({ name: wordKey(i), label: `Rotating word ${i + 1}`, base: word, max: TEXT_EFFECT_LIMITS.wordMax }))
}

/** Removes word `index`; the later words' Bangla moves up with them. */
export function removeWord(words: string[], translations: Translations, index: number): { words: string[]; translations: Translations } {
  const order = words.map((_, i) => i).filter((i) => i !== index)
  return { words: words.filter((_, i) => i !== index), translations: reorderBangla(translations, order) }
}

/** Moves word `index` by `by` (−1 up, +1 down); its Bangla moves with it. */
export function moveWord(words: string[], translations: Translations, index: number, by: -1 | 1): { words: string[]; translations: Translations } {
  const target = index + by
  if (target < 0 || target >= words.length) return { words, translations }
  const order = words.map((_, i) => i)
  order[index] = target
  order[target] = index
  return { words: order.map((i) => words[i]!), translations: reorderBangla(translations, order) }
}

/** Drops the word translations (the effect is no longer rotating words). */
export function withoutWordTranslations(translations: Translations): Translations {
  return reorderBangla(translations, [])
}

/** Problems of the words (as the server: 1–6 words, each 1–40 characters after trimming). */
export function wordProblems(words: readonly string[]): Record<number, string> {
  const out: Record<number, string> = {}
  words.forEach((word, i) => {
    const length = charCount(word.trim())
    if (length === 0) out[i] = 'Enter a word or remove it.'
    else if (length > TEXT_EFFECT_LIMITS.wordMax) out[i] = `At most ${TEXT_EFFECT_LIMITS.wordMax} characters.`
  })
  return out
}

/* ----------------------------------------------------------------------------------------------
 * Card hover (product listing elements)
 * -------------------------------------------------------------------------------------------- */

/** Backend `card_hover_elements`. */
export const CARD_HOVER_ELEMENTS: ReadonlySet<string> = new Set(B18_ENUMS.cardHoverElements)
/** Backend `card_hover_second_image_elements`: their product cards have a second picture. */
export const CARD_HOVER_SECOND_IMAGE: ReadonlySet<string> = new Set(B18_ENUMS.cardHoverSecondImageElements)

export const CARD_HOVERS: readonly CardHover[] = B18_ENUMS.cardHover

export function cardHoverOptions(type: string): CardHover[] {
  return CARD_HOVERS.filter((h) => h !== 'second_image' || CARD_HOVER_SECOND_IMAGE.has(type))
}
