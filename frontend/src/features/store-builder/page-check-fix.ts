import type { BuilderContent, BuilderNode, HeadingElement, ResponsiveStyle } from '@/storefront/builder/types'
import { writeStyleValue } from './inspector/style-model'
import type { PageCheckFix } from './page-check'
import { findNode, setNode } from './tree'

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
  }
}
