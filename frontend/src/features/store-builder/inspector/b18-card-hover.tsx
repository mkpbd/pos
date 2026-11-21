/*
 * B18 Card hover (contract §3) on the product listing elements: what each product / category card
 * does when a shopper points at it. "Show the second picture" only where the cards have one.
 */

import type { CardHover } from '@/storefront/builder/types'
import { HoverPreview, TileGroup } from './b18-motion-tiles'
import { CARD_HOVER_LABELS } from './b18-motion'
import { cardHoverOptions } from './b18-text-effect'
import type { BuilderNode, InspectorChangeOptions } from './types'

/** The hover preview each card effect borrows (the second picture shows as a picture swap). */
const PREVIEW: Record<CardHover, Parameters<typeof HoverPreview>[0]['effect']> = {
  none: 'none',
  lift: 'lift-shadow',
  zoom_image: 'zoom-image',
  tilt_3d: 'tilt-3d',
  glare: 'glare',
  second_image: 'zoom-image',
}

type CardNode = BuilderNode & { props: { card_hover?: CardHover } }

export function CardHoverPicker({ node, onChange, error }: { node: BuilderNode; onChange: (next: BuilderNode, opts?: InspectorChangeOptions) => void; error?: string }) {
  const n = node as CardNode
  const value = n.props.card_hover ?? 'none'
  const set = (hover: CardHover) => {
    const { card_hover: _old, ...rest } = n.props
    void _old
    onChange({ ...n, props: hover === 'none' ? rest : { ...rest, card_hover: hover } } as BuilderNode, { coalesceKey: `${n.id}:card_hover` })
  }
  return (
    <div className="mt-4 flex flex-col gap-1.5 border-t pt-4" data-check-field="card_hover" data-testid="card-hover-picker">
      <TileGroup
        label="Card hover"
        tooltip="What each card does when a shopper points at it with a mouse (phones and tablets don’t show it; shoppers who turned off animations see no movement)."
        value={value}
        options={cardHoverOptions(node.type).map((h) => ({ value: h, label: CARD_HOVER_LABELS[h] }))}
        onChange={set}
        testId="card-hover-tiles"
        renderTile={(option, state) => <HoverPreview effect={PREVIEW[option.value]} active={state.active} />}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
