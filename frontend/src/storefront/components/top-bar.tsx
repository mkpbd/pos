import { useState, type CSSProperties } from 'react'
import { Link } from 'react-router'
import { MailIcon, PauseIcon, PhoneIcon, PlayIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCustomer } from '../account/api'
import { useStorefront } from '../api'
import { useLocale } from '../i18n/locale'
import { useStoreLayout } from '../theme'
import type { Announcement } from '../types'
import { AnnouncementBar } from './announcement-bar'
import { LanguageSwitcher } from './language-switcher'
import { MenuLink } from './menu-link'
import { REDUCED_MOTION_QUERY, useIsDesktop, useMediaQuery } from './use-media-query'

/** How often the message repeats in one half of the ticker track (enough to span a wide screen). */
const TICKER_REPEATS = 6

/**
 * The strip above the header, by the theme's `top_bar`: `none` is today's announcement bar,
 * `ticker` scrolls the announcement, `utility` is a thin row of contact details and store links
 * (desktop; small screens show the announcement bar instead).
 */
export function TopBar() {
  const { theme } = useStorefront()
  const { top_bar: style } = useStoreLayout()
  const desktop = useIsDesktop()
  const announcement = theme.announcement

  if (style === 'ticker') return announcement ? <AnnouncementTicker announcement={announcement} /> : null
  if (style === 'utility' && desktop) return <UtilityBar />
  return announcement ? <AnnouncementBar announcement={announcement} /> : null
}

/**
 * The announcement as a gently scrolling marquee. The moving copies are decorative (aria-hidden);
 * one real link or text carries the message for assistive technology and the keyboard. Hovering
 * or focusing pauses it, a button stops it (WCAG 2.2.2), and it stands still for reduced motion.
 */
export function AnnouncementTicker({ announcement }: { announcement: Announcement }) {
  const { t } = useLocale()
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY)
  const [paused, setPaused] = useState(false)
  const style = { backgroundColor: announcement.background, color: announcement.foreground } as CSSProperties
  const moving = !reducedMotion
  // About 6 s per repeat of a 40-character message keeps the pace gentle whatever the length.
  const duration = `${Math.max(20, Math.round((announcement.text.length * TICKER_REPEATS) / 6))}s`

  const message = announcement.link ? (
    <MenuLink
      url={announcement.link}
      newTab={!announcement.link.startsWith('/')}
      className={cn('underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none', moving && 'absolute inset-0 z-10 text-transparent')}
    >
      {moving ? <span className="sr-only">{announcement.text}</span> : announcement.text}
    </MenuLink>
  ) : (
    <p className={cn(moving && 'sr-only')}>{announcement.text}</p>
  )

  return (
    <div
      className="sf-ticker relative flex items-center text-sm font-medium"
      style={style}
      role="region"
      aria-label={t('theme.ticker.label')}
      data-testid="announcement-ticker"
      data-motion={moving ? 'scroll' : 'static'}
      data-paused={paused || undefined}
    >
      {moving ? (
        <>
          <div className="relative min-w-0 flex-1 overflow-hidden py-2 has-[a:focus-visible]:outline-2 has-[a:focus-visible]:-outline-offset-2 has-[a:focus-visible]:outline-current">
            <div aria-hidden className="sf-ticker-track flex w-max" style={{ '--sf-ticker-duration': duration } as CSSProperties}>
              {[0, 1].map((half) => (
                <div key={half} className="flex shrink-0">
                  {Array.from({ length: TICKER_REPEATS }, (_, i) => (
                    <span key={i} className="flex items-center gap-8 pr-8 whitespace-nowrap">
                      {announcement.text}
                      <span className="text-[0.6em] opacity-70">✦</span>
                    </span>
                  ))}
                </div>
              ))}
            </div>
            {message}
          </div>
          <button
            type="button"
            onClick={() => setPaused((value) => !value)}
            aria-label={paused ? t('theme.ticker.play') : t('theme.ticker.pause')}
            aria-pressed={paused}
            className="grid size-8 shrink-0 place-items-center opacity-80 transition hover:opacity-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-current"
          >
            {paused ? <PlayIcon aria-hidden className="size-3.5" /> : <PauseIcon aria-hidden className="size-3.5" />}
          </button>
        </>
      ) : (
        <div className="w-full px-4 py-2 text-center">{message}</div>
      )}
    </div>
  )
}

/** Contact details on the left, the announcement in the middle, language and account links on the right. */
function UtilityBar() {
  const { theme } = useStorefront()
  const { header_style } = useStoreLayout()
  const { t } = useLocale()
  const customer = useCustomer()
  const { phone, email } = theme.footer.contact
  const announcement = theme.announcement
  // Over a commerce header the bar is dark (the heading colour, which passes AA against the surface by the admin check).
  const dark = header_style === 'commerce'
  const linkClass = cn('transition-colors', dark ? 'hover:text-sf-surface' : 'hover:text-sf-accent')

  return (
    <div className={cn('text-xs', dark ? 'bg-sf-heading text-sf-surface/85' : 'border-b bg-sf-canvas text-sf-text')} data-testid="utility-bar">
      <div className="mx-auto flex max-w-sf items-center justify-between gap-6 px-4 py-2">
        <div className="flex min-w-0 items-center gap-5">
          {phone && (
            <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} className={cn('inline-flex items-center gap-1.5', linkClass)}>
              <PhoneIcon aria-hidden className="size-3.5" />
              {phone}
            </a>
          )}
          {email && (
            <a href={`mailto:${email}`} className={cn('inline-flex min-w-0 items-center gap-1.5', linkClass)}>
              <MailIcon aria-hidden className="size-3.5 shrink-0" />
              <span className="truncate">{email}</span>
            </a>
          )}
        </div>
        {announcement && (
          <div className="min-w-0 flex-1 truncate text-center font-medium" data-testid="announcement-bar">
            {announcement.link ? (
              <MenuLink url={announcement.link} newTab={!announcement.link.startsWith('/')} className={cn('underline-offset-4 hover:underline', linkClass)}>
                {announcement.text}
              </MenuLink>
            ) : (
              <p className="truncate">{announcement.text}</p>
            )}
          </div>
        )}
        <nav aria-label={t('theme.topBar.label')} className="flex shrink-0 items-center gap-5">
          <LanguageSwitcher compact className="[&_button]:text-inherit" />
          <Link to="/wishlist" className={linkClass}>
            {t('common.wishlist')}
          </Link>
          <Link to={customer ? '/account' : '/account/login'} className={linkClass}>
            {customer ? t('common.account.myAccount') : t('common.account.signIn')}
          </Link>
        </nav>
      </div>
    </div>
  )
}
