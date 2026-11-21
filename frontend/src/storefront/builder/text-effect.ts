import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { useReducedMotion, watchEntry, TEXT_EFFECT_PLAY_EVENT } from './motion'
import { ambientMotionOn, useLongMotion, useMotionMode, usePausedMotion, type MotionMode } from './motion-pause'
import type { TextEffect, TextEffectColorRole, TextEffectSpeed } from './types'
import { normalizeTextEffect } from './validate'

/*
 * B18 text effects on heading, text and cta titles (`props.text_effect`). What is drawn from the
 * first render (so nothing ever shifts): the real text — what screen readers read and what sizes
 * the box — plus, for rotate_words, a slot as wide as the longest word holding every word (one
 * shown) and the words as a list for screen readers. Gradient shimmer and the highlight /
 * underline draw are CSS on the text. The JS-driven parts (typewriter, word / letter reveal, the
 * word rotation) live in the lazy module ./text-effects.ts, loaded only when an effect is on the
 * page and the visitor allows motion; it draws an aria-hidden, inert copy over the real text.
 *
 * Reduced motion: the final state (full text, first word, drawn highlight). The editor canvas
 * stays calm (final state) unless "Preview motion" is on, and replays on `play-motion`.
 */

/** Theme colour of the highlight / underline / shimmer (`secondary` = the theme's highlight colour). */
export const TEXT_EFFECT_COLORS: Record<TextEffectColorRole, string> = {
  primary: 'var(--sf-primary)',
  accent: 'var(--sf-accent)',
  secondary: 'var(--sf-highlight)',
}

/** How much longer (slow) or shorter (fast) every step of an effect takes. */
export const TEXT_EFFECT_SPEED: Record<TextEffectSpeed, number> = { slow: 1.6, normal: 1, fast: 0.6 }

/** Whether an effect keeps moving for longer than 5 s (the "Pause animations" toggle is offered). */
export function textEffectRunsLong(effect: TextEffect): boolean {
  if (effect.type === 'gradient_shimmer') return true
  // rotate_words: absent or null cycles = until paused; typewriter: only an explicit null loops forever.
  if (effect.type === 'rotate_words') return effect.cycles === undefined || effect.cycles === null
  return effect.type === 'typewriter' && effect.cycles === null
}

export function effectStyle(effect: TextEffect): CSSProperties {
  const factor = TEXT_EFFECT_SPEED[effect.speed ?? 'normal']
  const ms = effect.type === 'gradient_shimmer' ? 3000 : effect.type === 'highlight_draw' || effect.type === 'underline_draw' ? 900 : 500
  return { '--b-te-color': TEXT_EFFECT_COLORS[effect.color_role ?? 'accent'], '--b-te-ms': `${Math.round(ms * factor)}ms` } as CSSProperties
}

/** The parts the lazy module drives. */
const SCRIPTED = new Set(['typewriter', 'reveal_words', 'reveal_letters', 'rotate_words'])

export type TextEffectRuntime = { mode: MotionMode; paused: boolean }

/** Loads ./text-effects.ts and attaches the effect to `host` while mounted (never under reduced motion). */
export function useScriptedEffect(host: RefObject<HTMLElement | null>, effect: TextEffect | undefined, enabled: boolean, deps: unknown) {
  const mode = useMotionMode()
  const paused = usePausedMotion()
  const reduced = useReducedMotion()
  const key = JSON.stringify([effect, deps])
  const runtime = useRef<{ update: (state: TextEffectRuntime) => void; destroy: () => void } | null>(null)
  const state = useRef<TextEffectRuntime>({ mode, paused })
  useLayoutEffect(() => {
    state.current = { mode, paused }
    runtime.current?.update(state.current)
  })
  useEffect(() => {
    const element = host.current
    if (!enabled || !effect || reduced || !element || !SCRIPTED.has(effect.type)) return
    let cancelled = false
    void import('./text-effects').then(({ attachTextEffect }) => {
      if (cancelled || !element.isConnected) return
      runtime.current = attachTextEffect(element, effect, state.current, { watchEntry, playEvent: TEXT_EFFECT_PLAY_EVENT })
    })
    return () => {
      cancelled = true
      runtime.current?.destroy()
      runtime.current = null
    }
    // `key` stands for the effect and the drawn text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, key, enabled, reduced])
}

/** The highlight / underline draw: drawn when it enters the viewport (live), at once in the canvas (replayed on play-motion). */
export function useDrawState(host: RefObject<HTMLElement | null>, active: boolean): 'wait' | 'play' | undefined {
  const mode = useMotionMode()
  const [state, setState] = useState<'wait' | 'play' | undefined>(active && mode === 'live' ? 'wait' : undefined)
  useEffect(() => {
    const element = host.current
    if (!active || !element) return
    const stop = mode === 'live' ? watchEntry(element, () => setState('play')) : () => {}
    let frame = 0
    const replay = () => {
      setState('wait')
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => requestAnimationFrame(() => setState('play')))
    }
    element.addEventListener(TEXT_EFFECT_PLAY_EVENT, replay)
    return () => {
      stop()
      cancelAnimationFrame(frame)
      element.removeEventListener(TEXT_EFFECT_PLAY_EVENT, replay)
    }
  }, [host, active, mode])
  return active ? state : undefined
}

/* ----------------------------------------------------------------------------------------------
 * The text element (rich text): the same effects on its blocks. The slot and the highlight marks
 * are added to the rendered HTML before the first paint (layout effect) and removed again before
 * the HTML changes; the canvas strips them before an in-place edit (stripTextEffects).
 * -------------------------------------------------------------------------------------------- */

const BLOCKS = 'p,li,h1,h2,h3,h4,h5,h6,blockquote'

/** Removes the B18 decorations from rendered rich text (the rotating slot, the highlight marks). */
export function stripTextEffects(root: Element) {
  root.querySelectorAll('[data-b-te-slot]').forEach((slot) => {
    const label = slot.previousElementSibling
    if (label?.hasAttribute('data-b-te-label')) label.remove()
    slot.remove()
  })
  root.querySelectorAll('.b-te-mark[data-b-te-wrap]').forEach((mark) => mark.replaceWith(...Array.from(mark.childNodes)))
}

function decorate(root: HTMLElement, effect: TextEffect) {
  if (effect.type === 'rotate_words' && effect.words && effect.words.length > 0) {
    const blocks = root.querySelectorAll<HTMLElement>(BLOCKS)
    const last = blocks.length > 0 ? blocks[blocks.length - 1]! : root
    const label = document.createElement('span')
    label.className = 'sr-only'
    label.setAttribute('data-b-te-label', '')
    label.textContent = ` ${effect.words.join(', ')}`
    const slot = document.createElement('span')
    slot.className = 'b-te-rotate'
    slot.setAttribute('aria-hidden', 'true')
    slot.setAttribute('data-b-te-slot', '')
    effect.words.forEach((word, index) => {
      const span = document.createElement('span')
      span.setAttribute('data-te-word', String(index))
      if (index === 0) span.setAttribute('data-te-current', '')
      span.textContent = word
      slot.append(span)
    })
    last.append(label, document.createTextNode(' '), slot)
    return
  }
  if (effect.type === 'highlight_draw' || effect.type === 'underline_draw') {
    const blocks = Array.from(root.querySelectorAll<HTMLElement>(BLOCKS)).filter((block) => !block.querySelector(BLOCKS))
    for (const block of blocks.length > 0 ? blocks : [root]) {
      const mark = document.createElement('span')
      mark.className = 'b-te-mark'
      mark.setAttribute('data-te', effect.type)
      mark.setAttribute('data-b-te-wrap', '')
      mark.append(...Array.from(block.childNodes))
      block.append(mark)
    }
  }
}

/** Effect props of the text element's host div: class, data attributes and colour variables. */
export function useRichTextEffect(ref: RefObject<HTMLDivElement | null>, value: unknown, html: string): { className?: string; attributes: { 'data-b-te'?: string }; style?: CSSProperties } {
  const effect = normalizeTextEffect(value)
  const mode = useMotionMode()
  const reduced = useReducedMotion()
  const key = JSON.stringify(effect ?? null)
  const mark = effect?.type === 'highlight_draw' || effect?.type === 'underline_draw'
  useLongMotion(effect !== undefined && textEffectRunsLong(effect) && mode === 'live' && !reduced)
  useScriptedEffect(ref, effect, effect !== undefined, html)
  const draw = useDrawState(ref, mark)
  useLayoutEffect(() => {
    const element = ref.current
    const current = key === 'null' ? undefined : (JSON.parse(key) as TextEffect)
    if (!element || !current) return
    decorate(element, current)
    return () => stripTextEffects(element)
  }, [ref, key, html])
  useLayoutEffect(() => {
    // The marks carry the draw state (the host div is not inline).
    ref.current?.querySelectorAll('.b-te-mark[data-b-te-wrap]').forEach((element) => {
      if (draw) element.setAttribute('data-te-state', draw)
      else element.removeAttribute('data-te-state')
    })
  })
  if (!effect) return { attributes: {} }
  const shimmer = effect.type === 'gradient_shimmer' && ambientMotionOn(mode) && !reduced
  return {
    className: shimmer ? 'b-te-host b-te-shimmer' : 'b-te-host',
    attributes: { 'data-b-te': effect.type },
    style: effectStyle(effect),
  }
}
