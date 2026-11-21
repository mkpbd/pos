import { documentContext } from '@/storefront/builder/registry'
import { B19_LIMITS } from '@/storefront/builder/validate'
import type { PageCheckInput, PageCheckIssue } from './page-check'
import { Collector, focus, isObj, list, str, visibleAnywhere, type Obj } from './page-check-core'

/*
 * B19 §1/§3: the scroll part of the page check (same codes as the server's, so they merge):
 *  - SCROLL_EFFECT_TOP: the first shown section, or its first picture / heading (the MOTION_LCP
 *    candidates), has a scroll effect — the top of the page then appears late (Fix it: "Remove
 *    scroll effect", one undo step);
 *  - SCROLL_STORY_MEDIA: a scroll story step without a picture or its description (alt text);
 *  - HORIZONTAL_GALLERY_LONG: a pinned horizontal gallery with more than 8 entries — a long pinned
 *    scroll is tiring (Fix it: "Turn off pinning").
 * Warnings only: the owner decides.
 */

const IMAGE_ISH = new Set(['image', 'hero_slider', 'image_carousel'])
const HEADING_ISH = new Set(['heading', 'cta'])
const TOP_CONTEXTS = new Set(['page', 'cms', 'zone', 'header', 'template'])

type Node = Obj & { id?: unknown; type?: unknown; style?: unknown; props?: unknown; hidden?: unknown; columns?: unknown; elements?: unknown }

const shown = (node: Node) => node.hidden !== true && visibleAnywhere(node as { visibility?: Partial<Record<string, boolean>> })

function scrollEffect(node: Node): string | null {
  const base = isObj(node.style) && isObj(node.style.base) ? node.style.base : null
  const scroll = base && isObj(base.scroll) ? base.scroll : null
  const effect = scroll?.effect
  return typeof effect === 'string' && effect !== 'none' ? effect : null
}

/** The shown elements of a section in reading order (inner rows' elements included). */
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

const TOP_MESSAGES = {
  section: 'Your first section has a scroll effect, so the top of the page appears late. Remove it for a faster store.',
  image: 'Your top picture has a scroll effect, so it appears late. Remove it for a faster store.',
  heading: 'Your top heading has a scroll effect, so it appears late. Remove it for a faster store.',
} as const

export const SCROLL_CHECK_LIMITS = { galleryPinned: B19_LIMITS.horizontalGalleryPinTiring } as const

export function runScrollCheck(input: PageCheckInput): PageCheckIssue[] {
  const out = new Collector()
  const context = input.document.kind === 'popup' ? 'popup' : documentContext(input.document.key ?? '')
  const sections = (input.content.sections as unknown as Node[]).filter((s) => s.hidden !== true)

  // SCROLL_EFFECT_TOP: the first shown top-level section (a global section first: checked in the global).
  const top = (node: Node, kind: keyof typeof TOP_MESSAGES) => {
    const id = str(node.id)
    out.add(
      {
        code: 'SCROLL_EFFECT_TOP',
        severity: 'warning',
        message: TOP_MESSAGES[kind],
        node_id: id,
        field: null,
        fix: { kind: 'apply', label: 'Remove scroll effect', node_id: id, action: { type: 'remove-scroll-effect' } },
        details: { field: 'style.base.scroll.effect', kind, effect: scrollEffect(node), fix: 'remove_scroll_effect' },
      },
      null,
    )
  }
  const first = sections.find((s) => s.type === 'global_section' || shown(s))
  if (TOP_CONTEXTS.has(context) && first && first.type === 'section' && !isObj(first.global)) {
    if (scrollEffect(first)) top(first, 'section')
    const elements = elementsOf(first.columns)
    const image = elements.find((e) => IMAGE_ISH.has(str(e.type)))
    const heading = elements.find((e) => HEADING_ISH.has(str(e.type)))
    if (image && scrollEffect(image)) top(image, 'image')
    if (heading && scrollEffect(heading)) top(heading, 'heading')
  }

  for (const section of sections) {
    if (section.type !== 'section' || !shown(section)) continue
    for (const element of elementsOf(section.columns)) {
      const props = isObj(element.props) ? element.props : {}
      const id = str(element.id)
      if (element.type === 'scroll_story') {
        // SCROLL_STORY_MEDIA: every step needs its picture and the picture's description.
        const steps = list(props.steps).filter((step) => typeof step.media_id !== 'string' || step.media_id === '' || str(step.alt).trim() === '')
        if (steps.length === 0) continue
        const firstStep = steps[0]!
        const missingPicture = typeof firstStep.media_id !== 'string' || firstStep.media_id === ''
        out.add(
          {
            code: 'SCROLL_STORY_MEDIA',
            severity: 'warning',
            message:
              steps.length === 1
                ? 'A step of this scroll story has no picture or no description of its picture. Each step shows its own picture; the description is read aloud to shoppers who can’t see it.'
                : `${steps.length} steps of this scroll story have no picture or no description of their picture. Each step shows its own picture; the description is read aloud to shoppers who can’t see it.`,
            node_id: id,
            field: 'steps',
            fix: focus(missingPicture ? 'Choose a picture' : 'Describe the picture', id, `steps.${str(firstStep.id)}.${missingPicture ? 'media_id' : 'alt'}`),
            details: { field: 'props.steps', steps: steps.map((step) => str(step.id)) },
          },
          null,
        )
      } else if (element.type === 'horizontal_gallery') {
        // HORIZONTAL_GALLERY_LONG: pinned (default on) with more than 8 entries.
        if (props.pin === false) continue
        const count = props.source === 'products' ? (Array.isArray(props.product_ids) ? props.product_ids.filter((v) => typeof v === 'string').length : 0) : list(props.items).length
        if (count <= SCROLL_CHECK_LIMITS.galleryPinned) continue
        out.add(
          {
            code: 'HORIZONTAL_GALLERY_LONG',
            severity: 'warning',
            message: `This gallery has ${count} entries and stays pinned while shoppers scroll through all of them, which is tiring. Turn off pinning so they can swipe, or keep it to ${SCROLL_CHECK_LIMITS.galleryPinned} or fewer.`,
            node_id: id,
            field: 'pin',
            fix: { kind: 'apply', label: 'Turn off pinning', node_id: id, action: { type: 'turn-off-pin' } },
            details: { field: 'props.pin', count, limit: SCROLL_CHECK_LIMITS.galleryPinned, fix: 'turn_off_pin' },
          },
          null,
        )
      }
    }
  }
  return out.issues
}
