import { cn } from '@/lib/utils'
import { MenuLink } from '../components/menu-link'
import { useLocale } from '../i18n/locale'
import type { StoreBanner, StoreSection } from '../types'
import { bannerFallbackClass } from './banner-colors'
import { BannerPicture, BannerScrim, BannerText } from './banner-content'
import { SectionHeading } from './section-heading'

type Props = { section: Extract<StoreSection, { type: 'banner_grid' }> }

const COLUMNS = {
  '2-col': 'sm:grid-cols-2',
  '3-col': 'sm:grid-cols-2 lg:grid-cols-3',
  '4-col': 'sm:grid-cols-2 lg:grid-cols-4',
} as const

/**
 * An odd last tile in a two-column row (phones in landscape / tablets, or the 2-col layout) spans
 * the row as a wide banner instead of sitting alone next to a gap. From `lg` the 3- and 4-column
 * layouts have room for it, so it is a normal tile again.
 */
const WIDE_LAST_TILE = {
  '2-col': 'sm:col-span-2 sm:aspect-[8/3]',
  wider: 'sm:col-span-2 sm:aspect-[8/3] lg:col-span-1 lg:aspect-[4/3]',
} as const

function Tile({ banner, className }: { banner: StoreBanner; className?: string }) {
  const { t } = useLocale()
  const linkWhole = banner.link_url && !banner.button_label
  const inner = (
    <>
      <BannerPicture banner={banner} sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" className="absolute inset-0 transition-transform duration-500 group-hover:scale-105 motion-reduce:transition-none" />
      <BannerScrim banner={banner} from="bottom" />
      <div className="absolute inset-0 flex items-end p-6">
        <div className="w-full">
          <BannerText banner={banner} size="tile" />
        </div>
      </div>
    </>
  )

  return (
    <li className={cn('group relative min-h-56 overflow-hidden rounded-sf-card', bannerFallbackClass(banner), className)}>
      {linkWhole ? (
        <MenuLink url={banner.link_url!} aria-label={banner.title ?? banner.image.alt ?? t('content.section.openOffer')} className="absolute inset-0 block focus-visible:outline-4 focus-visible:-outline-offset-4">
          {inner}
        </MenuLink>
      ) : (
        inner
      )}
    </li>
  )
}

/** Promo tiles side by side. The split layout stacks two tiles in the middle column. */
export function BannerGrid({ section }: Props) {
  const { banners, config } = section
  const split = config.layout === '3-col-split' && banners.length === 4
  const columns = config.layout === '3-col-split' ? COLUMNS['3-col'] : COLUMNS[config.layout]

  return (
    <section className="mx-auto w-full max-w-sf px-4 py-10" aria-label={section.title ?? undefined}>
      <SectionHeading section={section} />
      {split ? (
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 lg:grid-rows-2">
          <Tile banner={banners[0]!} className="lg:row-span-2 lg:min-h-[30rem]" />
          <Tile banner={banners[1]!} />
          <Tile banner={banners[3]!} className="lg:col-start-3 lg:row-span-2 lg:row-start-1" />
          <Tile banner={banners[2]!} className="lg:col-start-2 lg:row-start-2" />
        </ul>
      ) : (
        <ul className={cn('grid gap-5', columns)}>
          {banners.map((b, i) => (
            <Tile key={b.id} banner={b} className={cn('aspect-[4/3]', i === banners.length - 1 && i % 2 === 0 && i > 0 && WIDE_LAST_TILE[config.layout === '2-col' ? '2-col' : 'wider'])} />
          ))}
        </ul>
      )}
    </section>
  )
}
