import { EyeOffIcon, UsersIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Audience } from '@/storefront/builder/audience/types'
import { evaluateAudience } from '@/storefront/builder/audience/evaluate'
import type { Rect } from '@/storefront/builder/canvas/protocol'
import { useAudienceData } from './lookups'
import { usePreviewContext } from './use-preview'
import { needsNames, type CanvasAudienceBadge } from './badges'
import { audienceBadgeText, describeAudience, type AudienceLookups } from './words'

/*
 * B13 "Who sees this" badges: on the canvas (in the editor's overlay, over the node's top right
 * corner) and in Layers (next to the row's name). With "Preview as" on, a node the previewed
 * shopper wouldn't see says so ("Hidden for this shopper").
 */

export function AudienceCanvasBadges({ badges, rects, scale, hide }: { badges: CanvasAudienceBadge[]; rects: Record<string, Rect>; scale: number; hide?: string | null }) {
  return (
    <>
      {badges.map((badge) => {
        const r = rects[badge.id]
        if (!r || r.h <= 0 || badge.id === hide) return null
        return (
          <span
            key={badge.id}
            data-testid={`audience-badge-${badge.id}`}
            data-out={badge.out || undefined}
            className={cn(
              'absolute flex max-w-56 -translate-x-full items-center gap-1 truncate rounded-sm px-1.5 py-0.5 text-[11px] leading-4 font-medium text-white shadow-sm',
              badge.out ? 'bg-neutral-700' : 'bg-violet-700',
            )}
            style={{ left: Math.max(0, (r.x + r.w) * scale - 4), top: Math.max(0, r.y * scale + 4) }}
          >
            {badge.out ? <EyeOffIcon className="size-3 shrink-0" aria-hidden /> : <UsersIcon className="size-3 shrink-0" aria-hidden />}
            <span className="truncate">{badge.out ? `Hidden for this shopper · ${badge.text}` : badge.text}</span>
          </span>
        )
      })}
    </>
  )
}

/** The Layers row's badge: a short text, the whole sentence as its accessible name and tooltip. */
export function AudienceLayerBadge({ id, audience, out, lookups }: { id: string; audience: Audience | null | undefined; out?: boolean; lookups?: AudienceLookups }) {
  const text = audienceBadgeText(audience, lookups)
  if (!text) return null
  const sentence = `${describeAudience(audience, lookups)}${out ? ' — hidden for the shopper you preview as' : ''}`
  return (
    <span
      data-testid={`layer-audience-${id}`}
      data-out={out || undefined}
      role="img"
      aria-label={`Who sees this: ${sentence}`}
      title={`Who sees this: ${sentence}`}
      className={cn(
        'flex max-w-28 shrink items-center gap-0.5 truncate rounded px-1 py-0.5 text-[10px] leading-none font-medium',
        out ? 'bg-neutral-200 text-neutral-800 dark:bg-neutral-700 dark:text-neutral-100' : 'bg-violet-100 text-violet-900 dark:bg-violet-900/50 dark:text-violet-100',
      )}
    >
      {out ? <EyeOffIcon className="size-2.5 shrink-0" aria-hidden /> : <UsersIcon className="size-2.5 shrink-0" aria-hidden />}
      <span className="truncate" aria-hidden>{text}</span>
    </span>
  )
}

/** The Layers row's badge for a node (nothing when it has no rules); names and "Preview as" from the editor. */
export function LayerAudienceBadge({ node }: { node: { id: string; audience?: Audience | null } }) {
  const audience = node.audience && node.audience.rules.length > 0 ? node.audience : null
  const context = usePreviewContext()
  const data = useAudienceData({ enabled: audience !== null && needsNames([{ audience }]) })
  if (!audience) return null
  const out = context ? !evaluateAudience(audience, context, { campaigns: data.campaignUtm }) : false
  return <AudienceLayerBadge id={node.id} audience={audience} out={out} lookups={data} />
}
