import { documentContext } from '@/storefront/builder/registry'
import { B20_LIMITS } from '@/storefront/builder/validate'
import type { PageCheckInput, PageCheckIssue } from './page-check'
import { Collector, focus, isObj, list, str, visibleAnywhere, type Obj } from './page-check-core'

/*
 * B20 §1: the animated graphics part of the page check (same codes as the server's, so they merge):
 *  - BACKGROUND_FX_MANY: more than 2 moving backgrounds (sections and inner rows) on the page — a
 *    busy page that also costs battery (Show me: the third one's Style tab);
 *  - ICON_LOOP_MANY: more than 6 animated icons playing in a loop (Show me: the seventh one's
 *    "When it plays");
 *  - ILLUSTRATION_TOP: a looping illustration in the first shown section — a heavy first screen
 *    (Fix it: "Play once when seen", `play` → `view`, one undo step).
 * Warnings only: the owner decides. The first two are page-wide (no node), like the server's.
 */

export const GRAPHICS_CHECK_LIMITS = { backgroundFx: B20_LIMITS.backgroundFxPerPage, iconLoops: B20_LIMITS.iconLoopsPerPage } as const

const TOP_CONTEXTS = new Set(['page', 'cms', 'zone', 'header', 'template'])

type Node = Obj & { id?: unknown; type?: unknown; style?: unknown; props?: unknown; hidden?: unknown; columns?: unknown; elements?: unknown; global?: unknown }

const shown = (node: Node) => node.hidden !== true && visibleAnywhere(node as { visibility?: Partial<Record<string, boolean>> })

/** The node's moving background type (`style.base.background_fx.type`), or null. */
export function backgroundFxOf(node: Node): string | null {
  const base = isObj(node.style) && isObj(node.style.base) ? node.style.base : null
  const fx = base && isObj(base.background_fx) ? base.background_fx : null
  const type = fx?.type
  return typeof type === 'string' && type !== 'none' ? type : null
}

/** The shown elements of a section in reading order (inner rows and their elements included). */
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

const props = (node: Node): Obj => (isObj(node.props) ? node.props : {})

export function runGraphicsCheck(input: PageCheckInput): PageCheckIssue[] {
  const out = new Collector()
  const context = input.document.kind === 'popup' ? 'popup' : documentContext(input.document.key ?? '')
  const sections = (input.content.sections as unknown as Node[]).filter((s) => s.type === 'section' && shown(s) && !isObj(s.global))

  const moving: string[] = []
  const looping: string[] = []
  for (const section of sections) {
    if (backgroundFxOf(section)) moving.push(str(section.id))
    for (const element of elementsOf(section.columns)) {
      if (element.type === 'inner_row' && backgroundFxOf(element)) moving.push(str(element.id))
      if (element.type === 'animated_icon' && props(element).trigger === 'loop' && props(element).animation !== 'none') looping.push(str(element.id))
    }
  }

  if (moving.length > GRAPHICS_CHECK_LIMITS.backgroundFx) {
    const extra = moving[GRAPHICS_CHECK_LIMITS.backgroundFx]!
    out.add(
      {
        code: 'BACKGROUND_FX_MANY',
        severity: 'warning',
        message: `${moving.length} parts of this page have a moving background. More than ${GRAPHICS_CHECK_LIMITS.backgroundFx} makes the page busy and tires phones; keep the movement for the parts that matter most.`,
        node_id: null,
        field: null,
        fix: focus('Show me', extra, null, 'style'),
        details: { path: 'sections', ids: moving, count: moving.length, limit: GRAPHICS_CHECK_LIMITS.backgroundFx },
      },
      null,
    )
  }

  if (looping.length > GRAPHICS_CHECK_LIMITS.iconLoops) {
    const extra = looping[GRAPHICS_CHECK_LIMITS.iconLoops]!
    out.add(
      {
        code: 'ICON_LOOP_MANY',
        severity: 'warning',
        message: `${looping.length} animated icons on this page play over and over. More than ${GRAPHICS_CHECK_LIMITS.iconLoops} pull the eye away from your products; let most of them play once when seen.`,
        node_id: null,
        field: null,
        fix: focus('Show me', extra, 'trigger'),
        details: { ids: looping, count: looping.length, limit: GRAPHICS_CHECK_LIMITS.iconLoops },
      },
      null,
    )
  }

  // ILLUSTRATION_TOP: the first shown top-level section (a global section first: checked in the global).
  const first = (input.content.sections as unknown as Node[]).find((s) => s.type === 'global_section' || (s.hidden !== true && shown(s)))
  if (TOP_CONTEXTS.has(context) && first && first.type === 'section' && !isObj(first.global)) {
    for (const element of elementsOf(first.columns)) {
      if (element.type !== 'illustration' || props(element).play !== 'loop') continue
      const id = str(element.id)
      out.add(
        {
          code: 'ILLUSTRATION_TOP',
          severity: 'warning',
          message: 'This illustration keeps moving at the top of the page, which makes the first screen heavy. Let it play once when it is seen instead.',
          node_id: id,
          field: 'play',
          fix: { kind: 'apply', label: 'Play once when seen', node_id: id, action: { type: 'set-play-view' } },
          details: { path: 'props.play', field: 'props.play', play: 'loop', fix: 'set_play_view' },
        },
        null,
      )
    }
  }
  return out.issues
}
