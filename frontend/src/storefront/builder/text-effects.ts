import type { TextEffectRuntime } from './text-effect'
import type { TextEffect } from './types'

/*
 * B18 text effects, the lazy part (loaded only when a page has a typewriter, a word / letter
 * reveal or rotating words, and the visitor allows motion). The real text stays in the DOM as the
 * accessible text and sizes the box; this module lays an aria-hidden, inert copy split into
 * pieces exactly over it while an effect plays, then removes the copy again. Splitting follows
 * grapheme clusters (Intl.Segmenter), never inside a conjunct (Bangla and other Indic scripts: a
 * cluster ending in a virama or a joiner joins the next one); without Intl.Segmenter whole words.
 *
 * Nothing that is already on screen when the page draws is hidden again (no animation on the first
 * paint): a reveal or a one-run typewriter only plays for text that scrolls into view later.
 */

/** Virama of the Indic scripts, ZWJ and ZWNJ: the next cluster belongs to the same written letter. */
const JOINS_NEXT = /[्্੍્୍்్್്්‌‍]$/u
const JOINS_PREVIOUS = /^[‌‍\p{M}]/u

type Segmenter = { segment: (input: string) => Iterable<{ segment: string }> }
let segmenter: Segmenter | null | undefined

function graphemeSegmenter(): Segmenter | null {
  if (segmenter !== undefined) return segmenter
  const Ctor = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: 'grapheme' }) => Segmenter }).Segmenter
  segmenter = typeof Ctor === 'function' ? new Ctor(undefined, { granularity: 'grapheme' }) : null
  return segmenter
}

/** Test hook: pretend Intl.Segmenter is (not) there. */
export function setSegmenterForTests(value: Segmenter | null | undefined) {
  segmenter = value
}

/**
 * A word's letters as the reader sees them: grapheme clusters, conjuncts kept whole. Without
 * Intl.Segmenter the whole word is one piece.
 */
export function graphemes(word: string): string[] {
  const seg = graphemeSegmenter()
  if (!seg) return word === '' ? [] : [word]
  const out: string[] = []
  for (const { segment } of seg.segment(word)) {
    const previous = out[out.length - 1]
    if (previous !== undefined && (JOINS_NEXT.test(previous) || JOINS_PREVIOUS.test(segment))) out[out.length - 1] = previous + segment
    else out.push(segment)
  }
  return out
}

/** Words and the white space between them, in order. */
export function splitWords(text: string): { text: string; space: boolean }[] {
  return text
    .split(/(\s+)/u)
    .filter((part) => part !== '')
    .map((part) => ({ text: part, space: /^\s+$/u.test(part) }))
}

export type SplitKind = 'words' | 'letters' | 'type'

function piece(text: string, index: number, className: string): HTMLSpanElement {
  const span = document.createElement('span')
  span.className = className
  span.style.setProperty('--i', String(index))
  span.textContent = text
  return span
}

/** One text node's pieces (the counter runs on across nodes). */
function splitNode(text: string, kind: SplitKind, counter: { i: number }, pieces: HTMLElement[]): DocumentFragment {
  const fragment = document.createDocumentFragment()
  for (const token of splitWords(text)) {
    if (kind === 'type') {
      for (const letter of graphemes(token.text)) {
        const span = piece(letter, counter.i++, 'b-te-type')
        span.style.visibility = 'hidden'
        pieces.push(span)
        fragment.append(span)
      }
    } else if (token.space) fragment.append(document.createTextNode(token.text))
    else if (kind === 'words') {
      const span = piece(token.text, counter.i++, 'b-te-piece')
      pieces.push(span)
      fragment.append(span)
    } else {
      const word = document.createElement('span')
      word.className = 'b-te-word'
      for (const letter of graphemes(token.text)) {
        const span = piece(letter, counter.i++, 'b-te-piece')
        pieces.push(span)
        word.append(span)
      }
      fragment.append(word)
    }
  }
  return fragment
}

/**
 * The aria-hidden, inert copy of `source`'s content split into pieces (ids dropped, so nothing is
 * duplicated). `tag`: span inside a heading, div over a rich text block.
 */
export function buildOverlay(source: Element, kind: SplitKind, tag: 'span' | 'div' = 'span'): { overlay: HTMLElement; pieces: HTMLElement[] } {
  const overlay = document.createElement(tag)
  overlay.className = 'b-te-fx'
  overlay.setAttribute('aria-hidden', 'true')
  overlay.setAttribute('inert', '')
  for (const child of Array.from(source.childNodes)) {
    if (child instanceof Element && (child.classList.contains('b-te-fx') || child.hasAttribute('data-b-te-slot') || child.hasAttribute('data-b-te-label'))) continue
    overlay.append(child.cloneNode(true))
  }
  overlay.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'))
  overlay.querySelectorAll('[data-b-te-slot],[data-b-te-label]').forEach((element) => element.remove())
  const pieces: HTMLElement[] = []
  const counter = { i: 0 }
  const walker = document.createTreeWalker(overlay, NodeFilter.SHOW_TEXT)
  const texts: Text[] = []
  while (walker.nextNode()) texts.push(walker.currentNode as Text)
  for (const node of texts) node.replaceWith(splitNode(node.data, kind, counter, pieces))
  return { overlay, pieces }
}

/** ms per piece / per letter / per word turn at normal speed. */
const STEP = { words: 90, letters: 35, type: 55, rotate: 2200, piece: 500 } as const
const SPEED = { slow: 1.6, normal: 1, fast: 0.6 } as const

function inViewport(element: Element): boolean {
  const rect = element.getBoundingClientRect()
  return rect.bottom > 0 && rect.top < window.innerHeight && rect.width > 0
}

type Hooks = { watchEntry: (element: HTMLElement, run: () => void) => () => void; playEvent: string }

/**
 * Attaches an effect to its host (the `.b-te` span of a heading / cta title, or the text
 * element's div). Returns the controls: `update` when the motion mode or the pause state change,
 * `destroy` on unmount.
 */
export function attachTextEffect(host: HTMLElement, effect: TextEffect, initial: TextEffectRuntime, hooks: Hooks) {
  let state = initial
  let timers: ReturnType<typeof setTimeout>[] = []
  let frames: number[] = []
  let overlay: HTMLElement | null = null
  let stopEntry: (() => void) | null = null
  let rotating = false
  const factor = SPEED[effect.speed ?? 'normal']
  const richText = !host.classList.contains('b-te')
  const source = richText ? host : (host.querySelector(':scope > .b-te-text') ?? host)

  const later = (ms: number, run: () => void) => timers.push(setTimeout(run, ms))
  const clearAll = () => {
    timers.forEach(clearTimeout)
    frames.forEach(cancelAnimationFrame)
    timers = []
    frames = []
  }
  const setPhase = (phase: 'wait' | 'play' | null) => {
    if (phase) host.setAttribute('data-te-state', phase)
    else host.removeAttribute('data-te-state')
  }
  /** Back to the real text. */
  const finish = () => {
    clearAll()
    overlay?.remove()
    overlay = null
    setPhase(null)
  }
  const show = (kind: SplitKind) => {
    overlay?.remove()
    const built = buildOverlay(source, kind, richText ? 'div' : 'span')
    overlay = built.overlay
    host.append(overlay)
    return built.pieces
  }
  const ambient = () => state.mode !== 'canvas' && !state.paused

  /* Reveal: pieces rise in one after another (CSS), then the copy goes. */
  const reveal = (fromWait: boolean) => {
    const kind: SplitKind = effect.type === 'reveal_letters' ? 'letters' : 'words'
    if (!fromWait || !overlay) {
      clearAll()
      show(kind)
    }
    const pieces = overlay?.querySelectorAll('.b-te-piece').length ?? 0
    const step = Math.round(STEP[kind] * factor)
    overlay?.style.setProperty('--b-te-step', `${step}ms`)
    setPhase('wait')
    frames.push(requestAnimationFrame(() => frames.push(requestAnimationFrame(() => setPhase('play')))))
    later(Math.max(0, pieces - 1) * step + Math.round(STEP.piece * factor) + 80, finish)
  }

  /* Typewriter: letters appear one by one with a caret; `cycles` runs (null = until paused). */
  let runsLeft = effect.cycles === null ? Infinity : (effect.cycles ?? 1)
  const type = () => {
    clearAll()
    if (state.paused) return finish()
    const pieces = show('type')
    const caret = document.createElement('span')
    caret.className = 'b-te-caret'
    overlay?.prepend(caret)
    setPhase('play')
    runsLeft -= 1
    const step = Math.round(STEP.type * factor)
    let count = 0
    const tick = () => {
      if (state.paused) return finish()
      const next = pieces[count]
      if (next) {
        next.style.visibility = 'visible'
        next.after(caret)
        count += 1
        later(step, tick)
        return
      }
      if (runsLeft > 0 && (state.mode !== 'canvas' || runsLeft !== Infinity)) later(1600, type)
      else later(700, finish)
    }
    later(step, tick)
  }

  /* Rotating words: the next word every few seconds; `cycles` full rounds (absent / null = until paused), resting on the first. */
  const words = () => Array.from(host.querySelectorAll<HTMLElement>('[data-b-te-slot] [data-te-word]'))
  let roundsLeft = effect.cycles === undefined || effect.cycles === null ? Infinity : effect.cycles
  let index = 0
  const turn = () => {
    const list = words()
    if (list.length < 2 || !rotating) return
    if (state.paused || (!ambient() && roundsLeft === Infinity)) {
      rotating = false
      return
    }
    index = (index + 1) % list.length
    list.forEach((word, i) => (i === index ? word.setAttribute('data-te-current', '') : word.removeAttribute('data-te-current')))
    if (index === 0) roundsLeft -= 1
    if (roundsLeft <= 0) {
      rotating = false
      return
    }
    later(Math.round(STEP.rotate * factor), turn)
  }
  const rotate = (rounds?: number) => {
    if (rounds !== undefined) roundsLeft = rounds
    if (rotating || roundsLeft <= 0) return
    rotating = true
    later(Math.round(STEP.rotate * factor), turn)
  }

  const play = () => {
    if (effect.type === 'rotate_words') {
      clearAll()
      rotating = false
      rotate(state.mode === 'live' ? roundsLeft : 1)
    } else if (effect.type === 'typewriter') {
      runsLeft = 1
      type()
    } else reveal(false)
  }
  host.addEventListener(hooks.playEvent, play)

  /** What runs on its own in this mode (also after a mode / pause change). */
  const start = (first: boolean) => {
    if (effect.type === 'rotate_words') {
      if (!ambient()) return
      if (state.mode === 'live' && first) stopEntry = hooks.watchEntry(host, () => rotate())
      else rotate()
      return
    }
    if (state.paused) return finish()
    if (state.mode !== 'live') {
      // The canvas: entrances only on request; a looping typewriter runs while "Preview motion" is on.
      if (effect.type === 'typewriter' && state.mode === 'canvas-preview' && effect.cycles === null && !overlay) later(1200, type)
      return
    }
    if (!first) return
    const loops = effect.type === 'typewriter' && runsLeft > 1
    if (inViewport(host)) {
      // Already painted: never hidden again. A looping typewriter starts over after a while.
      if (loops) {
        runsLeft -= 1
        later(2000, type)
      }
      return
    }
    if (effect.type === 'typewriter') {
      show('type')
      setPhase('wait')
      stopEntry = hooks.watchEntry(host, type)
    } else {
      show(effect.type === 'reveal_letters' ? 'letters' : 'words')
      setPhase('wait')
      stopEntry = hooks.watchEntry(host, () => reveal(true))
    }
  }
  start(true)

  return {
    update(next: TextEffectRuntime) {
      const changed = next.mode !== state.mode || next.paused !== state.paused
      state = next
      if (!changed) return
      if (effect.type === 'rotate_words') {
        if (ambient()) rotate()
        return
      }
      if (state.paused || (state.mode === 'canvas' && overlay && effect.type === 'typewriter' && effect.cycles === null)) finish()
      else start(false)
    },
    destroy() {
      host.removeEventListener(hooks.playEvent, play)
      stopEntry?.()
      rotating = false
      finish()
    },
  }
}
