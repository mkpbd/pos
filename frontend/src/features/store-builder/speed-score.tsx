import { GaugeIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SpeedRating } from './page-check-speed'

/*
 * B15 §4: the speed score at the top of the page check's "Speed" group — the number, its rating in
 * words (never colour alone) and a plain sentence. Presentational: the score comes from
 * `speedScore(issues)` (./page-check-speed.ts).
 */

const TONE: Record<SpeedRating, { text: string; bar: string }> = {
  fast: { text: 'text-emerald-700 dark:text-emerald-400', bar: 'bg-emerald-600 dark:bg-emerald-500' },
  average: { text: 'text-amber-700 dark:text-amber-400', bar: 'bg-amber-500' },
  slow: { text: 'text-destructive', bar: 'bg-destructive' },
}

const SENTENCE: Record<SpeedRating, string> = {
  fast: 'This page should open quickly, even on phone data.',
  average: 'This page could open faster. The tips below show what slows it down.',
  slow: 'This page will feel slow on phones. Start with the first items below.',
}

export function SpeedScore({ score, rating, label }: { score: number; rating: SpeedRating; label: string }) {
  const tone = TONE[rating]
  return (
    <div className="flex flex-col gap-1.5" data-testid="speed-score">
      <div className="flex items-center gap-2">
        <GaugeIcon className={cn('size-4 shrink-0', tone.text)} aria-hidden />
        <p className="flex-1 text-sm">
          <span className="font-semibold">Speed score: {score}</span>
          <span className="text-muted-foreground"> of 100 · </span>
          <span className={cn('font-medium', tone.text)} data-testid="speed-rating">
            {label}
          </span>
        </p>
      </div>
      <div
        role="meter"
        aria-label="Speed score"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={score}
        aria-valuetext={`${score} of 100, ${label}`}
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div className={cn('h-full rounded-full', tone.bar)} style={{ width: `${score}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">{SENTENCE[rating]} An estimate from the pictures, videos and fonts on the page.</p>
    </div>
  )
}
