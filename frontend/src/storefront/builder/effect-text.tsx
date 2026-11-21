import { useRef, type ReactNode } from 'react'
import { useReducedMotion } from './motion'
import { ambientMotionOn, useLongMotion, useMotionMode } from './motion-pause'
import { effectStyle, textEffectRunsLong, useDrawState, useScriptedEffect } from './text-effect'
import type { TextEffect } from './types'
import { normalizeTextEffect } from './validate'

/* B18 text effects on heading-like texts (heading `text`, cta `title`); the model and runtime: ./text-effect.ts. */

/**
 * A heading-like text (heading `text`, cta `title`) with its effect; the plain text when there is
 * none. Goes inside the heading element (and its link).
 */
export function EffectText({ value, text }: { value: unknown; text: string }): ReactNode {
  const effect = normalizeTextEffect(value)
  if (!effect || text === '') return text
  return <EffectTextView effect={effect} text={text} />
}

function EffectTextView({ effect, text }: { effect: TextEffect; text: string }) {
  const mode = useMotionMode()
  const reduced = useReducedMotion()
  const ref = useRef<HTMLSpanElement>(null)
  const ambient = ambientMotionOn(mode) && !reduced
  const mark = effect.type === 'highlight_draw' || effect.type === 'underline_draw'
  useLongMotion(textEffectRunsLong(effect) && mode === 'live' && !reduced)
  useScriptedEffect(ref, effect, true, text)
  const draw = useDrawState(ref, mark)
  const style = effectStyle(effect)

  if (effect.type === 'gradient_shimmer') {
    return (
      <span ref={ref} className={ambient ? 'b-te-shimmer' : undefined} data-b-te={effect.type} style={style}>
        {text}
      </span>
    )
  }
  if (mark) {
    return (
      <span ref={ref} className="b-te-mark" data-b-te={effect.type} data-te={effect.type} data-te-state={draw} style={style}>
        {text}
      </span>
    )
  }
  const words = effect.type === 'rotate_words' ? (effect.words ?? []) : []
  return (
    <span ref={ref} className="b-te" data-b-te={effect.type} style={style}>
      <span className="b-te-text">{text}</span>
      {words.length > 0 && (
        <>
          {' '}
          <span className="sr-only">{words.join(', ')}</span>
          <RotateSlot words={words} />
        </>
      )}
    </span>
  )
}

/** All the words stacked in one grid cell (as wide as the longest), the first one shown; ./text-effects.ts turns them. */
function RotateSlot({ words }: { words: string[] }) {
  return (
    <span className="b-te-rotate" aria-hidden data-b-te-slot="">
      {words.map((word, index) => (
        <span key={`${index}-${word}`} data-te-word={index} data-te-current={index === 0 ? '' : undefined}>
          {word}
        </span>
      ))}
    </span>
  )
}
