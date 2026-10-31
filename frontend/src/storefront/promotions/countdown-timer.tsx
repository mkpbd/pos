import { useEffect, useRef } from 'react'
import { ClockIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDateTime } from '../checkout/delivery'
import { COUNTDOWN_TICK, countdownParts, formatCountdown, useDeadline, useReducedMotion } from './countdown'

type Props = {
  endsAt: string | null | undefined
  /** chip: on product cards; inline: next to a price; large: the hot deals heading. */
  variant?: 'chip' | 'inline' | 'large'
  /** Words before the time ("Ends in"). */
  prefix?: string
  /** Called once when the time is up (the countdown then renders nothing). */
  onExpire?: () => void
  className?: string
}

/**
 * A countdown to a promotion's end: "05:04:03", "2d 05:04:03" from 24 hours on. The ticking
 * digits are hidden from assistive technology (a reader would hear them change every second);
 * screen readers get a static "Ends <date>" label instead. Visitors who prefer reduced motion
 * see minutes, updated once a minute. Renders nothing without an end or once it has passed.
 */
export function Countdown({ endsAt, variant = 'inline', prefix = 'Ends in', onExpire, className }: Props) {
  const reduced = useReducedMotion()
  const precision = reduced ? 'minutes' : 'seconds'
  const { remaining, expired } = useDeadline(endsAt, COUNTDOWN_TICK[precision])
  const expireRef = useRef(onExpire)

  useEffect(() => {
    expireRef.current = onExpire
  })

  useEffect(() => {
    if (expired) expireRef.current?.()
  }, [expired])

  if (remaining === null || expired || !endsAt) return null

  const label = (
    <span className="sr-only">
      Ends <time dateTime={endsAt}>{formatDateTime(endsAt)}</time>
    </span>
  )

  if (variant === 'large') {
    const parts = countdownParts(remaining, precision)
    const boxes: [number, string][] = [
      ...(parts.days > 0 ? ([[parts.days, parts.days === 1 ? 'Day' : 'Days']] as [number, string][]) : []),
      [parts.hours, 'Hours'],
      [parts.minutes, 'Mins'],
      ...(reduced ? [] : ([[parts.seconds, 'Secs']] as [number, string][])),
    ]
    return (
      <div className={cn('flex flex-col items-center gap-2 sm:items-end', className)} data-testid="countdown" aria-live="off">
        <p className="text-sm font-bold tracking-wide text-sf-sale uppercase" aria-hidden>
          {prefix}
        </p>
        <ol className="flex gap-2" aria-hidden data-testid="countdown-time" data-remaining={formatCountdown(remaining, precision)}>
          {boxes.map(([value, unit]) => (
            <li key={unit} className="flex min-w-14 flex-col items-center rounded-sf-card bg-sf-sale px-2 py-1.5 text-white shadow-sm">
              <span className="font-heading text-2xl leading-none font-extrabold tabular-nums lg:text-3xl">{String(value).padStart(2, '0')}</span>
              <span className="text-[0.65rem] font-semibold tracking-wide uppercase">{unit}</span>
            </li>
          ))}
        </ol>
        {label}
      </div>
    )
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 font-semibold text-sf-sale',
        variant === 'chip' ? 'rounded-full bg-sf-surface/95 px-2.5 py-0.5 text-xs shadow-sm' : 'text-sm',
        className,
      )}
      data-testid="countdown"
      aria-live="off"
    >
      <ClockIcon aria-hidden className={variant === 'chip' ? 'size-3.5' : 'size-4'} />
      <span aria-hidden data-testid="countdown-time" className="tabular-nums">
        {prefix ? `${prefix} ` : ''}
        {formatCountdown(remaining, precision)}
      </span>
      {label}
    </span>
  )
}
