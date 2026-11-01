import { StarIcon } from 'lucide-react'
import { ratingLabel } from '@/features/reviews/reviews'
import { cn } from '@/lib/utils'

/** Read-only stars; screen readers hear "4 out of 5 stars". */
export function StarRating({ rating, className }: { rating: number; className?: string }) {
  return (
    <span role="img" aria-label={ratingLabel(rating)} className={cn('inline-flex items-center gap-0.5', className)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <StarIcon key={n} aria-hidden className={cn('size-4', n <= rating ? 'fill-warning text-warning' : 'text-muted-foreground/40')} />
      ))}
    </span>
  )
}
