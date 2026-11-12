import { useEffect, useId, useState, type CSSProperties } from 'react'
import { Link } from 'react-router'
import { ClockIcon, ExternalLinkIcon, GlobeIcon, MailIcon, UserRoundIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ProductImage } from '../../catalog/product-image'
import { PRODUCT_RAIL_ITEM, Rail } from '../../catalog/product-rail'
import { SOCIAL_LABELS } from '../../components/footer-parts'
import { MenuLink } from '../../components/menu-link'
import { useLocale } from '../../i18n/locale'
import { Stars } from '../../reviews/stars'
import { isInternalLink } from '../../theme'
import type { SocialNetwork } from '../../types'
import { SOCIAL_GLYPHS } from '../icons'
import { DraftPlaceholder, PreviewMark } from '../preview-mark'
import { usePage } from '../render-context'
import type { BuilderMedia, ReviewWallItem, TeamLinkKind, WeekDay } from '../types'
import { B8A_ENUMS, B8A_LIMITS, B8A_TEXT_LIMITS, listItems, normalizeColumns, oneOf, safeLink, safeUrl, teamLinkUrl } from '../validate'
import { BuilderImg } from './b8a-img'
import { useB8aData } from './b8a-shared'
import { isReviewWallData, isStoreHoursData } from './guards'
import { str, type El } from './shared'
import { displayOrder, formatTime, hoursOf, openStatus, weekdayName, zonedNow, type Hours, type OpenStatus } from './store-hours'

/*
 * B8a trust & people (contract §1): team, review wall, photo grid and store hours.
 */

/** CSS variables of the shared column grid (`.b-gallery-grid`: base, tablet, mobile). */
function gridVars(columns: { base: number; tablet?: number; mobile?: number }, gap: string): CSSProperties {
  return { '--b-cols': columns.base, '--b-cols-t': columns.tablet ?? columns.base, '--b-cols-m': columns.mobile ?? columns.tablet ?? columns.base, '--b-gallery-gap': gap } as CSSProperties
}

/* -------------------------------------------------------------------------------------------- */

const SOCIAL_KINDS = Object.keys(SOCIAL_LABELS) as SocialNetwork[]
const InstagramGlyph = SOCIAL_GLYPHS.instagram

function isSocial(kind: TeamLinkKind): kind is SocialNetwork {
  return (SOCIAL_KINDS as string[]).includes(kind)
}

type Member = { id: string; media: BuilderMedia | null; name: string; role: string; bio: string; links: { id: string; kind: TeamLinkKind; url: string }[] }

/** The people behind the shop: photo, name, role, a short bio and their links (each named for screen readers). */
export function TeamElement({ element }: { element: El<'team'> }) {
  const { t } = useLocale()
  const p = element.props ?? {}
  const L = B8A_TEXT_LIMITS.team
  const media = useMediaMap()
  const members: Member[] = listItems(p.members, B8A_LIMITS.teamMembers.max)
    .map((member) => {
      const mediaId = typeof member.media_id === 'string' && Object.hasOwn(media, member.media_id) ? member.media_id : null
      return {
        id: member.id as string,
        media: mediaId ? media[mediaId]! : null,
        name: str(member.name).slice(0, L['members.*.name']).trim(),
        role: str(member.role).slice(0, L['members.*.role']).trim(),
        bio: str(member.bio).slice(0, L['members.*.bio']).trim(),
        links: listItems(member.links, B8A_LIMITS.teamLinks.max).flatMap((link) => {
          const kind = oneOf(link.kind, B8A_ENUMS.teamLinkKind)
          const url = kind ? teamLinkUrl(kind, link.url) : null
          return kind && url ? [{ id: link.id as string, kind, url }] : []
        }),
      }
    })
    .filter((member) => member.name !== '')
  if (members.length === 0) return <DraftPlaceholder element={element} />
  const style = oneOf(p.style, B8A_ENUMS.teamStyle) ?? 'card'
  const columns = normalizeColumns(p.columns, B8A_LIMITS.teamColumns, 3)

  return (
    <ul data-b={element.id} aria-label={t('content.builder.team.label')} className="b-team b-gallery-grid" style={gridVars(columns, '1.5rem')} data-style={style} data-testid="builder-team">
      {members.map((member) => (
        <li key={member.id}>
          <TeamCard member={member} style={style} columns={columns.base} />
        </li>
      ))}
    </ul>
  )
}

/** The payload's media map (list items are resolved in a loop, not one hook per item). */
function useMediaMap(): Record<string, BuilderMedia> {
  return usePage().page.media ?? {}
}

function TeamCard({ member, style, columns }: { member: Member; style: 'card' | 'plain' | 'circle'; columns: number }) {
  const { t } = useLocale()
  const circle = style === 'circle'
  const sizes = `(max-width: 639px) 50vw, ${Math.round(100 / columns)}vw`
  return (
    <article className={cn('flex h-full flex-col gap-3', style === 'card' && 'overflow-hidden rounded-sf-card border bg-sf-surface', circle && 'items-center text-center')} data-testid="team-member">
      <div className={cn('overflow-hidden bg-sf-canvas', circle ? 'aspect-square w-32 rounded-full' : 'aspect-square w-full', style === 'plain' && 'rounded-sf-card')}>
        {member.media ? (
          <BuilderImg media={member.media} alt="" sizes={circle ? '128px' : sizes} className="size-full object-cover" />
        ) : (
          <div aria-hidden className="grid size-full place-items-center text-sf-text">
            <UserRoundIcon className="size-1/3" />
          </div>
        )}
      </div>
      <div className={cn('flex flex-1 flex-col gap-1', style === 'card' && 'px-4 pb-4')}>
        <h3 className="font-heading text-lg font-extrabold text-sf-heading">{member.name}</h3>
        {member.role && <p className="text-sm font-semibold">{member.role}</p>}
        {member.bio && <p className="text-sm">{member.bio}</p>}
        {member.links.length > 0 && (
          <ul className={cn('mt-2 flex flex-wrap gap-1', circle && 'justify-center')}>
            {member.links.map((link) => (
              <li key={link.id}>
                <MemberLink name={member.name} kind={link.kind} url={link.url} newTabText={t('shell.footer.newTab')} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  )
}

function MemberLink({ name, kind, url, newTabText }: { name: string; kind: TeamLinkKind; url: string; newTabText: string }) {
  const { t } = useLocale()
  const className = 'grid size-10 place-items-center rounded-full text-sf-heading transition hover:bg-sf-canvas focus-visible:outline-2 focus-visible:outline-sf-accent'
  if (kind === 'email') {
    return (
      <a href={url} aria-label={t('content.builder.team.email', { name })} className={className}>
        <MailIcon aria-hidden className="size-5" />
      </a>
    )
  }
  const label = isSocial(kind) ? t('content.builder.team.on', { name, network: SOCIAL_LABELS[kind] }) : t('content.builder.team.website', { name })
  const Glyph = isSocial(kind) ? SOCIAL_GLYPHS[kind] : GlobeIcon
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`${label} ${newTabText}`} className={className}>
      <Glyph aria-hidden size={20} />
    </a>
  )
}

/* -------------------------------------------------------------------------------------------- */

function reviewsOf(value: unknown, limit: number): ReviewWallItem[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((review): review is ReviewWallItem => typeof review === 'object' && review !== null && typeof review.id === 'string' && typeof review.body === 'string' && typeof review.rating === 'number')
    .slice(0, limit)
}

/** Approved reviews of products on sale, as a grid or a carousel, with the average on top. */
export function ReviewWallElement({ element }: { element: El<'review_wall'> }) {
  const { t, digits } = useLocale()
  const { data, state, draft } = useB8aData(element.id, isReviewWallData)
  const p = element.props ?? {}
  const titleId = useId()
  const limit = typeof p.limit === 'number' ? Math.min(B8A_LIMITS.reviewLimit.max, Math.max(B8A_LIMITS.reviewLimit.min, p.limit)) : 6
  const reviews = reviewsOf(data?.reviews, limit)
  if (!data || reviews.length === 0) return <DraftPlaceholder element={element} />
  if (state && !draft) return null
  const title = str(p.title).slice(0, B8A_TEXT_LIMITS.review_wall.title).trim()
  const label = title || t('content.builder.reviews.label')
  const carousel = oneOf(p.layout, B8A_ENUMS.reviewLayout) === 'carousel'
  const showProduct = p.show_product !== false
  const summary = p.show_summary !== false && data.summary && typeof data.summary.count === 'number' && data.summary.count > 0 ? data.summary : null
  const cards = reviews.map((review) => <ReviewCard key={review.id} review={review} showProduct={showProduct} />)

  return (
    <PreviewMark state={state}>
      <section data-b={element.id} aria-labelledby={title ? titleId : undefined} aria-label={title ? undefined : label} className="b-review-wall flex flex-col gap-6" data-testid="builder-review-wall">
        {(title || summary) && (
          <div className="flex flex-col items-center gap-2 text-center">
            {title && (
              <h2 id={titleId} className="font-heading text-2xl font-extrabold text-sf-heading lg:text-3xl">
                {title}
              </h2>
            )}
            {summary && (
              <p className="flex flex-wrap items-center justify-center gap-2" data-testid="review-summary">
                <Stars rating={String(summary.average)} size="size-5" />
                <span className="font-semibold">{t('content.builder.reviews.summary', { average: digits(String(summary.average)), count: summary.count })}</span>
              </p>
            )}
          </div>
        )}
        {carousel ? (
          <Rail label={label} count={cards.length} itemClassName={PRODUCT_RAIL_ITEM}>
            {cards}
          </Rail>
        ) : (
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((card) => (
              <li key={card.key}>{card}</li>
            ))}
          </ul>
        )}
      </section>
    </PreviewMark>
  )
}

function ReviewCard({ review, showProduct }: { review: ReviewWallItem; showProduct: boolean }) {
  const { t, formatDate } = useLocale()
  const product = showProduct && review.product && typeof review.product.name === 'string' ? review.product : null
  const productUrl = product ? safeUrl(product.url) : null
  return (
    <article className="flex h-full flex-col gap-3 rounded-sf-card border bg-sf-surface p-5" data-testid="review-card">
      <Stars rating={Math.max(1, Math.min(5, Math.round(review.rating)))} />
      {review.title && <h3 className="font-bold text-sf-heading">{review.title}</h3>}
      <p className="text-sm whitespace-pre-line">{review.body}</p>
      <p className="mt-auto text-sm">
        <span className="font-semibold text-sf-heading">{review.author}</span>
        {review.created_at && (
          <>
            {' · '}
            <time dateTime={review.created_at}>{formatDate(review.created_at)}</time>
          </>
        )}
      </p>
      {product && (
        <div className="flex items-center gap-3 border-t pt-3">
          <ProductImage image={product.image ? { url: product.image.url, alt: product.image.alt ?? null } : null} alt="" className="size-10 shrink-0 rounded-md" />
          {productUrl ? (
            <Link to={productUrl} className="text-sm font-semibold text-sf-link hover:underline">
              <span className="sr-only">{t('content.builder.reviews.product', { product: product.name })}</span>
              <span aria-hidden>{product.name}</span>
            </Link>
          ) : (
            <span className="text-sm font-semibold">{product.name}</span>
          )}
        </div>
      )}
    </article>
  )
}

/* -------------------------------------------------------------------------------------------- */

const PHOTO_GAPS = { none: '0px', sm: '0.25rem', md: '0.75rem' } as const

/**
 * An Instagram-style square grid of the owner's own photos (no Instagram connection), with an
 * optional profile link. Linked photos open in the same tab unless the link leaves the store.
 */
export function PhotoGridElement({ element }: { element: El<'photo_grid'> }) {
  const { t } = useLocale()
  const media = useMediaMap()
  const p = element.props ?? {}
  const L = B8A_TEXT_LIMITS.photo_grid
  const images = listItems(p.images, B8A_LIMITS.photoImages.max).flatMap((image) => {
    const id = typeof image.media_id === 'string' && Object.hasOwn(media, image.media_id) ? image.media_id : null
    return id ? [{ id: image.id as string, media: media[id]!, alt: str(image.alt).slice(0, L['images.*.alt']).trim(), url: safeLink(image.link) }] : []
  })
  if (images.length === 0) return <DraftPlaceholder element={element} />
  const columns = normalizeColumns(p.columns, B8A_LIMITS.photoColumns, 4)
  const gap = PHOTO_GAPS[oneOf(p.gap, B8A_ENUMS.photoGap) ?? 'sm']
  const hover = oneOf(p.hover, B8A_ENUMS.photoHover) ?? 'overlay'
  const profile = p.profile && typeof p.profile === 'object' ? { label: str((p.profile as Record<string, unknown>).label).slice(0, L['profile.label']).trim(), url: safeUrl((p.profile as Record<string, unknown>).url) } : null
  const newTab = t('shell.footer.newTab')
  const sizes = `(max-width: 639px) ${Math.round(100 / (columns.mobile ?? columns.tablet ?? columns.base))}vw, ${Math.round(100 / columns.base)}vw`

  return (
    <div data-b={element.id} className="b-photo-grid flex flex-col gap-4" data-hover={hover} data-testid="builder-photo-grid">
      {profile?.label && profile.url && (
        <MenuLink
          url={profile.url}
          newTab={!isInternalLink(profile.url)}
          aria-label={isInternalLink(profile.url) ? undefined : `${profile.label} ${newTab}`}
          className="inline-flex items-center gap-2 self-center font-heading text-lg font-bold text-sf-heading hover:underline"
        >
          <InstagramGlyph size={22} aria-hidden />
          {profile.label}
        </MenuLink>
      )}
      <ul className="b-gallery-grid" style={gridVars(columns, gap)} aria-label={profile?.label || t('content.builder.photos.label')}>
        {images.map((image, i) => {
          const picture = (
            <span className="relative block aspect-square overflow-hidden bg-sf-surface">
              <BuilderImg
                media={image.media}
                alt={image.url ? '' : image.alt}
                sizes={sizes}
                className={cn('size-full object-cover', hover === 'zoom' && 'transition-transform duration-500 group-hover:scale-105 group-focus-visible:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100')}
              />
              {hover === 'overlay' && <span aria-hidden className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/30 motion-reduce:transition-none" />}
            </span>
          )
          if (!image.url) return <li key={image.id}>{picture}</li>
          const external = !isInternalLink(image.url)
          const name = image.alt || t('content.builder.photos.image', { index: i + 1, count: images.length })
          return (
            <li key={image.id}>
              <MenuLink url={image.url} newTab={external} className="group relative block focus-visible:outline-3 focus-visible:-outline-offset-3 focus-visible:outline-sf-accent">
                {picture}
                <span className="sr-only">
                  {name}
                  {external && ` ${newTab}`}
                </span>
                {external && hover === 'overlay' && <ExternalLinkIcon aria-hidden className="absolute top-2 right-2 size-4 text-white opacity-0 drop-shadow group-hover:opacity-100" />}
              </MenuLink>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/* -------------------------------------------------------------------------------------------- */

/** The current time, set after mount (no server / first-render mismatch) and refreshed at each minute. */
function useMinuteClock(enabled: boolean): Date | null {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      const date = new Date()
      setNow(date)
      timer = setTimeout(tick, 60_000 - (date.getTime() % 60_000) + 50)
    }
    tick()
    return () => clearTimeout(timer)
  }, [enabled])
  return now
}

/**
 * The week's opening hours (the shop's order: Saturday, Sunday or Monday first) in 12-hour times,
 * today marked with a "Today" label, and whether the shop is open now — computed in the store's
 * time zone after the page has loaded, refreshed every minute.
 */
export function StoreHoursElement({ element }: { element: El<'store_hours'> }) {
  const { t, locale, banglaDigits } = useLocale()
  const { data, state, draft } = useB8aData(element.id, isStoreHoursData)
  const p = element.props ?? {}
  const titleId = useId()
  const showStatus = p.show_open_now !== false
  const highlight = p.highlight_today !== false
  const now = useMinuteClock(showStatus || highlight)
  const hours = hoursOf(p.days)
  if (!hours) return <DraftPlaceholder element={element} />
  if (state && !draft) return null
  const digits = { locale, banglaDigits }
  const timezone = data?.timezone || 'Asia/Dhaka'
  const zoned = now ? zonedNow(now, timezone) : null
  const status = zoned && showStatus ? openStatus(hours, zoned) : null
  const today: WeekDay | null = zoned && highlight ? zoned.day : null
  const order = displayOrder(hours, oneOf(p.week_starts, B8A_ENUMS.weekStarts) ?? 'sat')
  const title = str(p.title).slice(0, B8A_TEXT_LIMITS.store_hours.title).trim()
  const note = str(p.note).slice(0, B8A_TEXT_LIMITS.store_hours.note).trim()
  const time = (minutes: number) => formatTime(minutes, digits)

  return (
    <PreviewMark state={state}>
      <section data-b={element.id} aria-labelledby={title ? titleId : undefined} aria-label={title ? undefined : t('content.builder.hours.label')} className="b-store-hours flex flex-col gap-4" data-testid="builder-store-hours">
        {title && (
          <h2 id={titleId} className="font-heading text-2xl font-extrabold text-sf-heading">
            {title}
          </h2>
        )}
        {status && <StatusLine status={status} time={time} day={(day) => weekdayName(day, digits)} />}
        <table className="w-full max-w-md border-collapse text-sm">
          <caption className="sr-only">{title || t('content.builder.hours.label')}</caption>
          <tbody>
            {order.map((day) => {
              const isToday = day.day === today
              return (
                <tr key={day.day} className={cn('border-b last:border-b-0', isToday && 'bg-sf-canvas font-bold text-sf-heading')} data-today={isToday || undefined}>
                  <th scope="row" className="py-2 pr-4 pl-2 text-left font-semibold">
                    {weekdayName(day.day, digits)}
                    {isToday && <span className="ml-2 rounded-full bg-sf-heading px-2 py-0.5 text-xs font-bold text-sf-surface">{t('content.builder.hours.today')}</span>}
                  </th>
                  <td className="py-2 pr-2 text-right tabular-nums">{dayHours(day, time, t)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {note && <p className="text-sm">{note}</p>}
      </section>
    </PreviewMark>
  )
}

function dayHours(day: Hours, time: (minutes: number) => string, t: ReturnType<typeof useLocale>['t']): string {
  if (day.closed) return t('content.builder.hours.closed')
  if (day.open === day.close) return t('content.builder.hours.allDay')
  return t('content.builder.hours.range', { open: time(day.open), close: time(day.close) })
}

function StatusLine({ status, time, day }: { status: OpenStatus; time: (minutes: number) => string; day: (day: WeekDay) => string }) {
  const { t } = useLocale()
  const text = status.open
    ? status.closes === null
      ? t('content.builder.hours.openAllDay')
      : t('content.builder.hours.openNow', { time: time(status.closes) })
    : status.opens === null
      ? t('content.builder.hours.closedNow')
      : status.opens.today
        ? t('content.builder.hours.opensToday', { time: time(status.opens.minutes) })
        : t('content.builder.hours.opensOn', { time: time(status.opens.minutes), day: day(status.opens.day) })
  return (
    <p className="inline-flex items-center gap-2 self-start rounded-full border px-3 py-1 text-sm font-semibold text-sf-heading" data-open={status.open} data-testid="hours-status">
      <ClockIcon aria-hidden className="size-4" />
      {text}
    </p>
  )
}
