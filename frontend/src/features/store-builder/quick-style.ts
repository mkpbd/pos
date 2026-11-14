import type { Breakpoint, BuilderContent, BuilderNode, ResponsiveStyle } from '@/storefront/builder/types'
import { styleIsValid, writeStyleValue, type StylePath } from './inspector/style-model'
import { findNode, setNode } from './tree'

/* B10 quick bar (./quick-bar.tsx): which elements get it and how it writes a style value for one device. */

export type QuickAlign = 'left' | 'center' | 'right'

/** Element types whose text alignment and colour the quick bar sets. */
export const QUICK_TEXT_TYPES: ReadonlySet<string> = new Set(['heading', 'text', 'quote', 'notice', 'icon_box', 'icon_list', 'copyright', 'counter', 'steps'])

export const ALIGN_PATH: StylePath = ['typography', 'align']
export const COLOR_PATH: StylePath = ['color']

/** The content with a style value set on the node for the breakpoint (unchanged when the result would be invalid). */
export function setNodeStyleValue(content: BuilderContent, id: string, breakpoint: Breakpoint, path: StylePath, value: unknown): BuilderContent {
  const info = findNode(content, id)
  if (!info) return content
  const node = info.node as BuilderNode & { style?: ResponsiveStyle }
  const style = writeStyleValue(node.style ?? {}, breakpoint, path, value)
  if (!styleIsValid(style)) return content
  return setNode(content, { ...node, style } as BuilderNode)
}

