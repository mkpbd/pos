/* The Style tab's groups per node type (B3). */

import { isWrappedSectionType } from '@/storefront/builder/registry'
import type { BuilderNode } from './types'
import { B6_TYPES } from './validate'

export type GroupId = 'background' | 'button-colors' | 'color' | 'typography' | 'spacing' | 'size' | 'layout' | 'border' | 'shadow' | 'effects' | 'text-effects' | 'hover' | 'motion' | 'background-video'

export type GroupSpec = { id: GroupId; open?: boolean }

export const GROUP_TITLES: Record<GroupId, string> = {
  background: 'Background',
  'button-colors': 'Colours',
  color: 'Colour',
  typography: 'Text',
  spacing: 'Spacing',
  size: 'Size',
  layout: 'Layout',
  border: 'Border & corners',
  shadow: 'Shadow',
  effects: 'Effects',
  'text-effects': 'Effects',
  hover: 'Hover',
  motion: 'Animation',
  'background-video': 'Background video',
}

export const GROUP_TIPS: Partial<Record<GroupId, string>> = {
  spacing: 'Room around (margin) and inside (padding) this part of the page.',
  layout: 'How the columns or elements inside sit next to each other.',
  hover: 'What happens when a shopper points at it with the mouse.',
  effects: 'Shadow and see-through.',
  motion: 'An entrance animation that plays once when shoppers scroll to it.',
}

const B6_MEDIA = new Set(['gallery', 'image_carousel', 'logo_carousel', 'map', 'category_card', 'product_spotlight', 'shop_the_look'])

/** The style groups of a node type, most used first (open); B6: every node ends with Animation. */
export function groupsFor(node: BuilderNode): GroupSpec[] {
  return [...baseGroups(node), { id: 'motion' }]
}

function baseGroups(node: BuilderNode): GroupSpec[] {
  if (B6_TYPES.has(node.type)) {
    if (node.type === 'chart') return [{ id: 'spacing', open: true }, { id: 'background' }, { id: 'border' }, { id: 'effects' }]
    if (B6_MEDIA.has(node.type)) return [{ id: 'spacing', open: true }, { id: 'size' }, { id: 'border' }, { id: 'effects' }]
    return [{ id: 'typography', open: true }, { id: 'color' }, { id: 'spacing', open: true }, { id: 'background' }, { id: 'border' }, { id: 'effects' }]
  }
  switch (node.type) {
    case 'section':
    case 'inner_row':
      return [{ id: 'background', open: true }, { id: 'spacing', open: true }, { id: 'layout', open: true }, { id: 'size' }, { id: 'border' }, { id: 'effects' }, { id: 'background-video' }]
    case 'column':
      return [{ id: 'size', open: true }, { id: 'spacing', open: true }, { id: 'layout' }, { id: 'background' }, { id: 'border' }, { id: 'effects' }]
    case 'heading':
    case 'text':
      return [{ id: 'typography', open: true }, { id: 'color', open: true }, { id: 'spacing', open: true }, { id: 'text-effects' }]
    case 'button':
      return [{ id: 'button-colors', open: true }, { id: 'typography' }, { id: 'spacing' }, { id: 'size' }, { id: 'border' }, { id: 'shadow' }, { id: 'hover' }]
    case 'image':
      return [{ id: 'size', open: true }, { id: 'border', open: true }, { id: 'shadow' }, { id: 'effects' }, { id: 'hover' }]
    case 'divider':
    case 'spacer':
      return [{ id: 'size', open: true }, { id: 'spacing', open: true }]
  }
  if (isWrappedSectionType(node.type)) return [{ id: 'background', open: true }, { id: 'spacing', open: true }, { id: 'border' }]
  return []
}

