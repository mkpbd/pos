import { useId, useState } from 'react'
import { StarIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

const STARS = [1, 2, 3, 4, 5] as const

const starLabel = (n: number) => `${n} ${n === 1 ? 'star' : 'stars'}`

/** A rating shown as five stars (partly filled for averages) with a text alternative: "Rated 4.5 out of 5". */
export function Stars({ rating, className, size = 'size-4' }: { rating: number | string; className?: string; size?: string }) {
  const value = Math.max(0, Math.min(5, Number(rating) || 0))
  const label = `Rated ${typeof rating === 'string' ? rating : String(value)} out of 5`
  return (
    <span role="img" aria-label={label} className={cn('relative inline-flex shrink-0', className)} data-testid="stars">
      <span aria-hidden className="flex text-sf-border">
        {STARS.map((n) => (
          <StarIcon key={n} className={cn(size, 'fill-current')} />
        ))}
      </span>
      <span aria-hidden className="absolute inset-y-0 left-0 flex overflow-hidden text-sf-primary" style={{ width: `${(value / 5) * 100}%` }}>
        {STARS.map((n) => (
          <StarIcon key={n} className={cn(size, 'shrink-0 fill-current')} />
        ))}
      </span>
    </span>
  )
}

/**
 * The rating input: a radio group of five stars ("1 star" … "5 stars"). Arrow keys move between
 * the stars as with any radio group; the stars up to the chosen (or hovered) one are filled.
 */
export function StarRatingInput({ value, onChange, error, disabled }: { value: number | null; onChange: (rating: number) => void; error?: string; disabled?: boolean }) {
  const id = useId()
  const [hover, setHover] = useState<number | null>(null)
  const shown = hover ?? value ?? 0

  return (
    <fieldset role="radiogroup" className="flex flex-col gap-1.5" aria-describedby={error ? `${id}-error` : undefined} disabled={disabled}>
      <legend className="mb-1.5 text-sm font-medium text-sf-heading">Your rating</legend>
      <div className="flex gap-1" onMouseLeave={() => setHover(null)}>
        {STARS.map((n) => (
          <label key={n} className="cursor-pointer rounded-md p-0.5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-sf-accent" onMouseEnter={() => setHover(n)}>
            <input type="radio" name={`${id}-rating`} value={n} checked={value === n} onChange={() => onChange(n)} className="sr-only" />
            <span className="sr-only">{starLabel(n)}</span>
            <StarIcon aria-hidden className={cn('size-8 transition', n <= shown ? 'fill-current text-sf-primary' : 'text-sf-border')} />
          </label>
        ))}
      </div>
      {error && (
        <p id={`${id}-error`} className="text-sm text-sf-sale">
          {error}
        </p>
      )}
    </fieldset>
  )
}
