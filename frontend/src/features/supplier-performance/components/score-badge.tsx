import { Badge } from '@/components/ui/badge'
import { formatScore, scoreBand } from '@/features/supplier-performance/performance'

/** 0–100 supplier score with its band ("82 · Good"); "No data" when nothing could be measured. */
export function ScoreBadge({ score }: { score: string | null | undefined }) {
  const band = scoreBand(score)
  const value = formatScore(score)
  return (
    <Badge variant={band.variant} title={value === '—' ? 'Not enough data to score' : `Score ${value} of 100`}>
      {value === '—' ? band.label : `${value} · ${band.label}`}
    </Badge>
  )
}
