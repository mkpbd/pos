import type { BuilderContent, BuilderNode, HeadingElement, ResponsiveStyle } from '@/storefront/builder/types'
import { motionState, toMotion } from './inspector/b9-motion'
import { writeStyleValue } from './inspector/style-model'
import type { PageCheckFix } from './page-check'
import { findNode, moveBy, setNode } from './tree'

/*
 * B10: executes an `apply` Fix it of the page check (./page-check.ts) on the draft, purely:
 * `store.getState().apply((c) => applyPageCheckFix(c, fix))` is one undo step. A fix whose node is
 * gone (or of another type) leaves the content as it is.
 */

export function applyPageCheckFix(content: BuilderContent, fix: PageCheckFix): BuilderContent {
  if (fix.kind !== 'apply') return content
  const info = findNode(content, fix.node_id)
  if (!info) return content
  const node = info.node
  const action = fix.action
  switch (action.type) {
    case 'set-color':
      if (!('style' in node)) return content
      return setNode(content, { ...node, style: writeStyleValue(node.style as ResponsiveStyle, action.breakpoint, ['color'], action.color) } as BuilderNode)
    case 'set-text-size':
      if (!('style' in node)) return content
      return setNode(content, { ...node, style: writeStyleValue(node.style as ResponsiveStyle, action.breakpoint, ['typography', 'size'], action.size) } as BuilderNode)
    case 'show-on-all-devices':
      if (!('visibility' in node)) return content
      return setNode(content, { ...node, visibility: { desktop: true, tablet: true, mobile: true } } as BuilderNode)
    case 'set-heading-level':
      if (node.type !== 'heading') return content
      return setNode(content, { ...(node as HeadingElement), props: { ...(node as HeadingElement).props, level: action.level } })
    case 'move-down':
      // B15 "Move the video lower": a section below the next one (the last stays put).
      return moveBy(content, node.id, 1)
    case 'remove-entrance': {
      // B18 "Remove animation": no entrance (its duration, delay and easing go with it); loops stay.
      if (!('style' in node)) return content
      const style = (node.style ?? {}) as ResponsiveStyle
      const motion = style.base?.motion
      if (!motion || motion.entrance === 'none') return content
      return setNode(content, { ...node, style: writeStyleValue(style, 'base', ['motion'], toMotion({ ...motionState(motion), entrance: 'none' })) } as BuilderNode)
    }
    case 'remove-scroll-effect': {
      // B19 "Remove scroll effect": `style.base.scroll` goes (the rest of the motion stays).
      if (!('style' in node)) return content
      const style = (node.style ?? {}) as ResponsiveStyle
      if (!style.base?.scroll) return content
      return setNode(content, { ...node, style: writeStyleValue(style, 'base', ['scroll'], undefined) } as BuilderNode)
    }
    case 'turn-off-pin': {
      // B19 "Turn off pinning": the horizontal gallery becomes a swipeable row.
      if (node.type !== 'horizontal_gallery' || !('props' in node)) return content
      const props = node.props as Record<string, unknown>
      if (props.pin === false) return content
      return setNode(content, { ...node, props: { ...props, pin: false } } as BuilderNode)
    }
  }
}
