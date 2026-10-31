import { cn } from '@/lib/utils'
import { MenuLink } from '../components/menu-link'
import type { StoreBanner, StoreSection } from '../types'
import { BannerPicture, BannerText } from './banner-content'
import { SectionHeading } from './section-heading'

type Props = { section: Extract<StoreSection, { type: 'banner_grid' }> }

const COLUMNS = {
  '2-col': 'sm:grid-cols-2',
  '3-col': 'sm:grid-cols-2 lg:grid-cols-3',
  '4-col': 'sm:grid-cols-2 lg:grid-cols-4',
} as const

function Tile({ banner, className }: { banner: StoreBanner; className?: string }) {
  const linkWhole = banner.link_url && !banner.button_label
  const inner = (
    <>
      <BannerPicture banner={banner} sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" className="absolute inset-0 transition-transform duration-500 group-hover:scale-105 motion-reduce:transition-none" />
      <div className="absolute inset-0 flex items-end p-6">
        <div className="w-full">
          <BannerText banner={banner} size="tile" />
        </div>
      </div>
    </>
  )

  return (
    <li className={cn('group relative min-h-56 overflow-hidden rounded-sf-card bg-sf-border', className)}>
      {linkWhole ? (
        <MenuLink url={banner.link_url!} aria-label={banner.title ?? banner.image.alt ?? 'Open offer'} className="absolute inset-0 block focus-visible:outline-4 focus-visible:-outline-offset-4">
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
          {banners.map((b) => <Tile key={b.id} banner={b} className="aspect-[4/3]" />)}
        </ul>
      )}
    </section>
  )
}
