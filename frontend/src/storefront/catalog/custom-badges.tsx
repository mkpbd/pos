import { useContext, type CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import { BootstrapContext } from '../api'
import type { CustomBadge } from '../types'
import { badgeColors, customBadgesOf } from './badge-colors'

/**
 * P1b: the owner's own labels (≤ 2) as list items, for the badge list of a card or the product
 * photo. `className` is the card style's badge shape; colours come from the tone (AA text colour).
 * `style` adds per-badge positioning (the arched card stacks them down its right edge).
 */
export function CustomBadgeItems({ badges, className, style }: { badges: unknown; className?: string; style?: (index: number) => CSSProperties | undefined }) {
  const colors = useContext(BootstrapContext)?.theme.colors
  const list: CustomBadge[] = customBadgesOf(badges)
  return list.map((badge, i) => (
    <li
      key={`${badge.tone}-${badge.text}-${i}`}
      className={cn('max-w-full truncate', className)}
      style={{ ...badgeColors(colors, badge.tone), ...style?.(i) }}
      title={badge.text}
      data-testid="custom-badge"
      data-tone={badge.tone}
    >
      {badge.text}
    </li>
  ))
}
