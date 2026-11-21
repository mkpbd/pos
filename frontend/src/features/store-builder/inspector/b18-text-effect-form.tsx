/*
 * B18 Text effect form (contract §3) on the Content tab of headings, texts and calls to action
 * (their title): the effect as tiles, the rotating words (1–6; their Bangla goes in the element's
 * Bangla section, see `textEffectBanglaFields`), speed, colour (from the theme roles) and how often
 * it runs. Shoppers who turned off animations see the whole text at once.
 */

import { useId } from 'react'
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { TextEffect, TextEffectType } from '@/storefront/builder/types'
import { B18_ENUMS } from '@/storefront/builder/validate'
import { HelpTip, Segmented, SelectControl } from '../controls'
import type { Translations } from './bangla'
import { TileGroup } from './b18-motion-tiles'
import {
  COLOR_ROLE_LABELS,
  effectiveCycles,
  effectText,
  effectTextOf,
  moveWord,
  removeWord,
  revealLettersBlocked,
  SPEED_LABELS,
  TEXT_EFFECT_FIELDS,
  TEXT_EFFECT_HINTS,
  TEXT_EFFECT_LABELS,
  TEXT_EFFECT_LIMITS,
  TEXT_EFFECT_TYPES,
  textEffectState,
  toTextEffect,
  usesColorRole,
  usesCycles,
  withoutWordTranslations,
  wordProblems,
  type CyclesChoice,
  type TextEffectState,
} from './b18-text-effect'
import type { Errors } from './fields'
import type { InspectorChangeOptions } from './types'

type EffectNode = { id: string; type: string; props: { text_effect?: TextEffect }; translations: Translations }

/** A tiny still picture of each effect for its tile. */
function EffectGlyph({ type }: { type: TextEffectType }) {
  const base = 'text-[11px] font-semibold leading-none text-foreground'
  let body
  switch (type) {
    case 'none':
      body = <span className={cn(base, 'text-muted-foreground')}>Abc</span>
      break
    case 'typewriter':
      body = (
        <span className={base}>
          Ab<span className="ml-px inline-block h-3 w-px bg-primary align-middle" />
        </span>
      )
      break
    case 'rotate_words':
      body = (
        <span className="flex flex-col items-center leading-none">
          <span className="text-[9px] text-muted-foreground/70">old</span>
          <span className={cn(base, 'text-primary')}>new</span>
        </span>
      )
      break
    case 'reveal_words':
      body = (
        <span className={base}>
          Ab <span className="opacity-40">cd</span> <span className="opacity-15">ef</span>
        </span>
      )
      break
    case 'reveal_letters':
      body = (
        <span className={base}>
          A<span className="opacity-60">b</span>
          <span className="opacity-30">c</span>
          <span className="opacity-10">d</span>
        </span>
      )
      break
    case 'gradient_shimmer':
      body = <span className={cn(base, 'bg-gradient-to-r from-foreground via-primary to-foreground bg-clip-text text-transparent')}>Abcd</span>
      break
    case 'highlight_draw':
      body = <span className={cn(base, 'bg-gradient-to-r from-primary/40 from-60% to-transparent to-60% px-0.5')}>Abcd</span>
      break
    case 'underline_draw':
      body = (
        <span className={cn(base, 'relative')}>
          Abcd
          <span className="absolute inset-x-0 -bottom-1 h-0.5 w-2/3 bg-primary" />
        </span>
      )
      break
  }
  return (
    <span aria-hidden className="flex h-8 w-full items-center justify-center rounded-sm bg-muted/60">
      {body}
    </span>
  )
}

const CYCLE_OPTIONS = (type: TextEffectType) => [
  { value: 'default', label: type === 'rotate_words' ? 'Until paused (default)' : 'Once (default)' },
  ...[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: n === 1 ? 'Once' : `${n} times` })),
  { value: 'forever', label: 'Until the shopper pauses it' },
]

const fromCycles = (value: string): CyclesChoice => (value === 'default' ? 'default' : value === 'forever' ? null : Number(value))
const toCyclesValue = (cycles: CyclesChoice) => (cycles === 'default' ? 'default' : cycles === null ? 'forever' : String(cycles))

export function TextEffectForm<N extends EffectNode>({ node, onChange, errors }: { node: N; onChange: (next: N, opts?: InspectorChangeOptions) => void; errors: Errors }) {
  const id = useId()
  const effect = node.props.text_effect
  const state = textEffectState(effect)
  const field = TEXT_EFFECT_FIELDS[node.type] ?? 'text'
  const bnText = node.translations?.bn?.[field]
  const lettersBlocked = revealLettersBlocked(effectText(node.type, node.props), bnText ? effectTextOf(node.type, bnText) : null)

  const write = (next: TextEffectState, translations: Translations = node.translations, key = 'text_effect') => {
    const value = toTextEffect(next)
    const { text_effect: _old, ...rest } = node.props
    void _old
    const props = value ? { ...rest, text_effect: value } : rest
    onChange({ ...node, props, translations } as N, { coalesceKey: `${node.id}:${key}` })
  }
  const setType = (type: TextEffectType) => {
    // Leaving rotating words drops the words' Bangla; starting them gives one empty word to fill in.
    const words = type === 'rotate_words' ? (state.words.length > 0 ? state.words : ['']) : []
    write({ ...state, type, words }, type === 'rotate_words' ? node.translations : withoutWordTranslations(node.translations ?? {}))
  }
  const words = state.words
  const problems = wordProblems(words)
  const cycles = effectiveCycles(state)

  return (
    <fieldset className="flex flex-col gap-3 rounded-md border p-3" data-check-field="text_effect" data-testid="text-effect-form">
      <legend className="flex items-center gap-1.5 px-1 text-sm font-medium">
        Text effect
        <HelpTip label="Text effect" text="Make the text move to catch the eye. Shoppers who turned off animations on their device see the whole text at once." />
      </legend>
      <TileGroup
        label="Effect"
        value={state.type}
        options={TEXT_EFFECT_TYPES.map((t) => ({
          value: t,
          label: TEXT_EFFECT_LABELS[t],
          title: t === 'reveal_letters' && lettersBlocked ? lettersBlocked : TEXT_EFFECT_HINTS[t],
          disabled: t === 'reveal_letters' && lettersBlocked !== null && state.type !== 'reveal_letters',
        }))}
        onChange={setType}
        testId="text-effect-tiles"
        renderTile={(option) => <EffectGlyph type={option.value} />}
      />
      <p className="text-xs text-muted-foreground" aria-live="polite">{TEXT_EFFECT_HINTS[state.type]}</p>
      {lettersBlocked && <p className={cn('text-xs', state.type === 'reveal_letters' ? 'text-destructive' : 'text-muted-foreground')}>{lettersBlocked}</p>}
      {errors['text_effect.type'] && <p className="text-xs text-destructive">{errors['text_effect.type']}</p>}

      {state.type === 'rotate_words' && (
        <div className="flex flex-col gap-2" data-testid="rotating-words">
          <p id={`${id}-words`} className="text-sm font-medium">Rotating words</p>
          <p className="text-xs text-muted-foreground">
            They take turns right after the {node.type === 'text' ? 'text' : node.type === 'cta' ? 'title' : 'heading'} (the space fits the longest word, so nothing jumps). Bangla words go in the Bangla section below.
          </p>
          <ol className="flex flex-col gap-1.5" aria-labelledby={`${id}-words`}>
            {words.map((word, i) => {
              const problem = errors[`text_effect.words.${i}`] ?? problems[i]
              return (
                <li key={i} className="flex flex-col gap-1">
                  <div className="flex items-center gap-1">
                    <Input
                      aria-label={`Rotating word ${i + 1}`}
                      value={word}
                      maxLength={TEXT_EFFECT_LIMITS.wordMax + 10}
                      aria-invalid={problem ? true : undefined}
                      onChange={(e) => write({ ...state, words: words.map((w, j) => (j === i ? e.target.value : w)) }, node.translations, `text_effect.words.${i}`)}
                      className="h-8"
                    />
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move word ${i + 1} up`} disabled={i === 0} onClick={() => {
                      const next = moveWord(words, node.translations ?? {}, i, -1)
                      write({ ...state, words: next.words }, next.translations)
                    }}>
                      <ArrowUpIcon />
                    </Button>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move word ${i + 1} down`} disabled={i === words.length - 1} onClick={() => {
                      const next = moveWord(words, node.translations ?? {}, i, 1)
                      write({ ...state, words: next.words }, next.translations)
                    }}>
                      <ArrowDownIcon />
                    </Button>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove word ${i + 1}`} disabled={words.length <= TEXT_EFFECT_LIMITS.words.min} onClick={() => {
                      const next = removeWord(words, node.translations ?? {}, i)
                      write({ ...state, words: next.words }, next.translations)
                    }}>
                      <XIcon />
                    </Button>
                  </div>
                  {problem && <p className="text-xs text-destructive">{problem}</p>}
                  {!problem && [...word.trim()].length > TEXT_EFFECT_LIMITS.longWord && (
                    <p className="text-xs text-amber-700 dark:text-amber-400">Long words are hard to read while they change; try {TEXT_EFFECT_LIMITS.longWord} characters or fewer.</p>
                  )}
                </li>
              )
            })}
          </ol>
          {errors['text_effect.words'] && <p className="text-xs text-destructive">{errors['text_effect.words']}</p>}
          <Button type="button" variant="outline" size="sm" className="w-fit" disabled={words.length >= TEXT_EFFECT_LIMITS.words.max} onClick={() => write({ ...state, words: [...words, ''] })}>
            <PlusIcon data-icon="inline-start" /> Add a word
          </Button>
          {words.length >= TEXT_EFFECT_LIMITS.words.max && <p className="text-xs text-muted-foreground">At most {TEXT_EFFECT_LIMITS.words.max} words.</p>}
        </div>
      )}

      {state.type !== 'none' && (
        <Segmented label="Speed" value={state.speed} options={B18_ENUMS.textEffectSpeed.map((s) => ({ value: s, label: SPEED_LABELS[s] }))} onChange={(speed) => write({ ...state, speed })} />
      )}
      {usesColorRole(state.type) && (
        <Segmented
          label="Colour"
          tooltip="From your Site styles, so it changes with your theme."
          value={state.color_role}
          options={B18_ENUMS.textEffectColorRole.map((r) => ({ value: r, label: COLOR_ROLE_LABELS[r] }))}
          onChange={(color_role) => write({ ...state, color_role })}
        />
      )}
      {usesCycles(state.type) && (
        <>
          <SelectControl
            label={state.type === 'typewriter' ? 'Type it' : 'Change the words'}
            value={toCyclesValue(state.cycles)}
            options={CYCLE_OPTIONS(state.type)}
            onChange={(v) => write({ ...state, cycles: fromCycles(v) })}
          />
          {cycles === null && <p className="text-xs text-muted-foreground">It keeps going, so shoppers get a “Pause animations” button on the page.</p>}
        </>
      )}
    </fieldset>
  )
}
