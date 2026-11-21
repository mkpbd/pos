import { useLocale } from '../i18n/locale'
import { REDUCED_MOTION_QUERY, useMediaQuery } from '../components/use-media-query'
import { setMotionPaused, useLongMotionCount, usePausedMotion } from './motion-pause'

/**
 * B18 "Pause animations" / "Play animations" (WCAG 2.2.2 Pause, Stop, Hide): a floating pill at the
 * bottom left, shown only while the page has motion that runs longer than 5 s (and never for
 * visitors who prefer reduced motion — nothing moves for them). It sits in the DOM right after the
 * store header, so keyboard users reach it early. The choice is remembered (./motion-pause.ts).
 */
export function MotionPauseToggle() {
  const { t } = useLocale()
  const count = useLongMotionCount()
  const paused = usePausedMotion()
  const reduced = useMediaQuery(REDUCED_MOTION_QUERY)
  if (count === 0 || reduced) return null
  return (
    <button
      type="button"
      aria-pressed={paused}
      onClick={() => setMotionPaused(!paused)}
      data-testid="motion-pause-toggle"
      className="sf-motion-toggle fixed left-4 z-40 inline-flex min-h-11 items-center gap-2 rounded-full border bg-sf-surface/95 px-4 text-sm font-semibold text-sf-heading shadow-lg backdrop-blur hover:bg-sf-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent"
    >
      <svg aria-hidden viewBox="0 0 16 16" className="size-4" fill="currentColor" focusable="false">
        {paused ? <path d="M4 2.5v11l9-5.5z" /> : <path d="M4 2.5h3v11H4zM9 2.5h3v11H9z" />}
      </svg>
      {paused ? t('content.motion.play') : t('content.motion.pause')}
    </button>
  )
}
