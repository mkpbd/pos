import { documentContext } from '@/storefront/builder/registry'
import { textEffectSource } from '@/storefront/builder/validate'
import type { PageCheckInput, PageCheckIssue } from './page-check'
import { Collector, focus, isObj, list, str, visibleAnywhere, type Obj } from './page-check-core'
import { effectTextOf, TEXT_EFFECT_FIELDS, TEXT_EFFECT_LIMITS, charCount } from './inspector/b18-text-effect'

/*
 * B18 §5: the motion part of the page check (same codes as the server's, so they merge):
 *  - MOTION_LCP: the first shown section, or its first picture / heading, has an entrance — the
 *    biggest thing on the first screen then appears late (Fix it: "Remove animation", one undo step);
 *  - MOTION_TOO_MUCH: more than 6 things loop in one section, or more than 3 loop forever on the page;
 *  - TEXT_EFFECT_LONG: a rotating word over 24 characters, or a typewriter text over 160.
 * Warnings only: the owner decides.
 */

export const MOTION_CHECK_LIMITS = { loopsPerSection: 6, loopForever: 3 } as const

/** Where the first screen's biggest thing can be (backend MOTION_LCP). */
const IMAGE_ISH = new Set(['image', 'hero_slider', 'image_carousel'])
const HEADING_ISH = new Set(['heading', 'cta'])
const LCP_CONTEXTS = new Set(['page', 'cms', 'zone', 'header', 'template'])

type Node = Obj & { id?: unknown; type?: unknown; style?: unknown; props?: unknown; hidden?: unknown; columns?: unknown; elements?: unknown }

function motionOf(node: Node): Obj | null {
  const base = isObj(node.style) && isObj(node.style.base) ? node.style.base : null
  return base && isObj(base.motion) ? base.motion : null
}

const entering = (node: Node) => {
  const entrance = motionOf(node)?.entrance
  return typeof entrance === 'string' && entrance !== 'none'
}
const looping = (node: Node) => {
  const loop = motionOf(node)?.loop
  return typeof loop === 'string' && loop !== 'none'
}
const shown = (node: Node) => node.hidden !== true && visibleAnywhere(node as { visibility?: Partial<Record<string, boolean>> })

/** The elements of a section in reading order (inner rows' elements included; hidden ones left out). */
function elementsOf(columns: unknown): Node[] {
  const out: Node[] = []
  for (const column of list(columns) as Node[]) {
    for (const element of list(column.elements) as Node[]) {
      if (!shown(element)) continue
      out.push(element)
      if (element.type === 'inner_row') out.push(...elementsOf(element.columns))
    }
  }
  return out
}

/** Every node of a section that can move (the section, its columns, inner rows' columns and elements). */
function nodesOf(section: Node): Node[] {
  const out: Node[] = [section]
  const walk = (columns: unknown) => {
    for (const column of list(columns) as Node[]) {
      out.push(column)
      for (const element of list(column.elements) as Node[]) {
        if (!shown(element)) continue
        out.push(element)
        if (element.type === 'inner_row') walk(element.columns)
      }
    }
  }
  walk(section.columns)
  return out
}

const LCP_MESSAGES = {
  section: 'Your first section appears late because it has an entrance animation. Remove its animation for a faster store.',
  image: 'Your top picture appears late; remove its animation for a faster store.',
  heading: 'Your top heading appears late; remove its animation for a faster store.',
} as const

export function runMotionCheck(input: PageCheckInput): PageCheckIssue[] {
  const out = new Collector()
  const key = input.document.key ?? ''
  const context = input.document.kind === 'popup' ? 'popup' : documentContext(key)
  const sections = (input.content.sections as unknown as Node[]).filter((s) => s.hidden !== true)
  const lcp = (node: Node, kind: keyof typeof LCP_MESSAGES) => {
    const id = str(node.id)
    out.add(
      {
        code: 'MOTION_LCP',
        severity: 'warning',
        message: LCP_MESSAGES[kind],
        node_id: id,
        field: null,
        fix: { kind: 'apply', label: 'Remove animation', node_id: id, action: { type: 'remove-entrance' } },
        details: { field: 'style.base.motion.entrance', fix: 'remove_entrance' },
      },
      null,
    )
  }

  // MOTION_LCP: the first shown top-level section (a global section first: changed in the global, not checked).
  const first = sections.find((s) => s.type === 'global_section' || shown(s))
  if (LCP_CONTEXTS.has(context) && first && first.type === 'section' && !isObj(first.global)) {
    if (entering(first)) lcp(first, 'section')
    const elements = elementsOf(first.columns)
    const image = elements.find((e) => IMAGE_ISH.has(str(e.type)))
    const heading = elements.find((e) => HEADING_ISH.has(str(e.type)))
    if (image && entering(image)) lcp(image, 'image')
    if (heading && entering(heading)) lcp(heading, 'heading')
  }

  // MOTION_TOO_MUCH: loops per section, and loop forever on the whole page.
  const forever: string[] = []
  for (const section of sections) {
    if (section.type !== 'section' || !shown(section)) continue
    const nodes = nodesOf(section)
    const loops = nodes.filter(looping)
    forever.push(...loops.filter((n) => motionOf(n)?.loop_forever === true).map((n) => str(n.id)))
    if (loops.length > MOTION_CHECK_LIMITS.loopsPerSection) {
      const id = str(section.id)
      out.add(
        {
          code: 'MOTION_TOO_MUCH',
          severity: 'warning',
          message: `${loops.length} things in this section keep moving at once. That is tiring to look at: keep an attention loop on one or two things (at most ${MOTION_CHECK_LIMITS.loopsPerSection}).`,
          node_id: id,
          field: null,
          fix: focus('Select the section', id, null, 'style'),
          details: { ids: loops.map((n) => str(n.id)), count: loops.length, limit: MOTION_CHECK_LIMITS.loopsPerSection },
        },
        null,
      )
    }
  }
  if (forever.length > MOTION_CHECK_LIMITS.loopForever) {
    out.add(
      {
        code: 'MOTION_TOO_MUCH',
        severity: 'warning',
        message: `${forever.length} animations on this page keep looping forever. Let most of them stop after a few times (turn off “Keep looping”; at most ${MOTION_CHECK_LIMITS.loopForever}).`,
        node_id: null,
        field: null,
        fix: focus('Show the first one', forever[0]!, null, 'style'),
        details: { ids: forever, count: forever.length, limit: MOTION_CHECK_LIMITS.loopForever },
      },
      null,
    )
  }

  // TEXT_EFFECT_LONG.
  for (const section of sections) {
    if (section.type !== 'section' || !shown(section)) continue
    for (const element of elementsOf(section.columns)) {
      const type = str(element.type)
      const props = isObj(element.props) ? element.props : {}
      const effect = isObj(props.text_effect) ? props.text_effect : null
      if (!effect || !Object.hasOwn(TEXT_EFFECT_FIELDS, type)) continue
      const bn = isObj(element.translations) && isObj(element.translations.bn) ? (element.translations.bn as Obj) : {}
      const id = str(element.id)
      if (effect.type === 'rotate_words') {
        const words = (Array.isArray(effect.words) ? effect.words : []).map((w) => str(w))
        const bnWords = Object.entries(bn).filter(([k]) => k.startsWith('text_effect.words.')).map(([, v]) => str(v))
        const longest = Math.max(0, ...[...words, ...bnWords].map((w) => charCount(w.trim())))
        if (longest > TEXT_EFFECT_LIMITS.longWord) {
          out.add(
            {
              code: 'TEXT_EFFECT_LONG',
              severity: 'warning',
              message: `A rotating word has ${longest} characters, so it is hard to read while it changes. Use words of ${TEXT_EFFECT_LIMITS.longWord} characters or fewer.`,
              node_id: id,
              field: 'text_effect',
              fix: focus('Shorten the words', id, 'text_effect'),
              details: { field: 'props.text_effect.words', limit: TEXT_EFFECT_LIMITS.longWord },
            },
            null,
          )
        }
      } else if (effect.type === 'typewriter') {
        const field = TEXT_EFFECT_FIELDS[type]!
        const texts = [textEffectSource(type, props), ...(typeof bn[field] === 'string' ? [effectTextOf(type, bn[field] as string)] : [])]
        const longest = Math.max(...texts.map((t) => charCount(t)))
        if (longest > TEXT_EFFECT_LIMITS.longTypewriter) {
          out.add(
            {
              code: 'TEXT_EFFECT_LONG',
              severity: 'warning',
              message: `This text is long for the typewriter effect (${longest} characters), so shoppers wait to read it. Use a text of ${TEXT_EFFECT_LIMITS.longTypewriter} characters or fewer, or another effect.`,
              node_id: id,
              field: 'text_effect',
              fix: focus('Change the effect', id, 'text_effect'),
              details: { field: 'props.text_effect.type', limit: TEXT_EFFECT_LIMITS.longTypewriter },
            },
            null,
          )
        }
      }
    }
  }
  return out.issues
}
