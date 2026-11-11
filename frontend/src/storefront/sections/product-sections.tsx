import { ArrowRightIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ProductCard } from '../catalog/product-card'
import { PRODUCT_RAIL_ITEM, Rail } from '../catalog/product-rail'
import { Tabs } from '../catalog/product-tabs'
import { MediaImage } from '../components/media-image'
import { MenuLink } from '../components/menu-link'
import { useLocale } from '../i18n/locale'
import type { ProductCard as Card, StoreSection } from '../types'
import { SectionHeading } from './section-heading'

const GRID_COLUMNS: Record<3 | 4 | 5, string> = {
  3: 'md:grid-cols-3',
  4: 'md:grid-cols-3 lg:grid-cols-4',
  5: 'md:grid-cols-3 lg:grid-cols-5',
}

function ViewAll({ url }: { url: string | null | undefined }) {
  const { t } = useLocale()
  if (!url) return null

  return (
    <div className="mt-6 text-center">
      <MenuLink
        url={url}
        className="inline-flex items-center gap-2 rounded-sf-button bg-sf-primary px-6 py-3 text-sm font-bold tracking-wide text-sf-primary-foreground uppercase transition hover:brightness-105"
      >
        {t('content.section.viewAll')}
        <ArrowRightIcon aria-hidden className="size-4" />
      </MenuLink>
    </div>
  )
}

function ProductRail({ label, products }: { label: string; products: Card[] }) {
  return (
    <Rail label={label} count={products.length} itemClassName={PRODUCT_RAIL_ITEM}>
      {products.map((p) => (
        <ProductCard key={p.id} product={p} />
      ))}
    </Rail>
  )
}

export function ProductCarouselSection({ section }: { section: Extract<StoreSection, { type: 'product_carousel' }> }) {
  const { t } = useLocale()
  const label = section.title ?? t('content.section.products')
  return (
    <section className="mx-auto w-full max-w-sf px-4 py-10" aria-label={label}>
      <SectionHeading section={section} />
      <ProductRail label={label} products={section.products} />
      <ViewAll url={section.config.view_all_url} />
    </section>
  )
}

export function ProductGridSection({ section }: { section: Extract<StoreSection, { type: 'product_grid' }> }) {
  const { t } = useLocale()
  return (
    <section className="mx-auto w-full max-w-sf px-4 py-10" aria-label={section.title ?? t('content.section.products')}>
      <SectionHeading section={section} />
      <ul className={cn('grid grid-cols-2 gap-3 sm:gap-5', GRID_COLUMNS[section.config.columns] ?? GRID_COLUMNS[4])}>
        {section.products.map((p) => (
          <li key={p.id}>
            <ProductCard product={p} />
          </li>
        ))}
      </ul>
      <ViewAll url={section.config.view_all_url} />
    </section>
  )
}

/** Pill tabs (e.g. New arrivals / Best sellers / On sale), each a product carousel. Empty tabs are left out. */
export function ProductTabsSection({ section }: { section: Extract<StoreSection, { type: 'product_tabs' }> }) {
  const { t } = useLocale()
  const tabs = section.tabs.filter((tab) => tab.products.length > 0)

  return (
    <section className="mx-auto w-full max-w-sf px-4 py-10" aria-label={section.title ?? t('content.section.products')}>
      <SectionHeading section={section} />
      <Tabs
        label={section.title ?? t('content.section.productCollections')}
        tabListClassName="justify-center"
        tabs={tabs.map((tab, i) => ({ id: `${i}-${tab.label}`, label: tab.label, content: <ProductRail label={tab.label} products={tab.products} /> }))}
      />
    </section>
  )
}

export function CategoryStrip({ section }: { section: Extract<StoreSection, { type: 'category_strip' }> }) {
  const { t } = useLocale()
  const label = section.title ?? t('content.section.shopByCategory')

  return (
    <section className="mx-auto w-full max-w-sf px-4 py-10" aria-label={label}>
      <SectionHeading section={section} />
      <Rail label={label} count={section.categories.length} itemClassName="w-32 sm:w-36" centerWhenFits>
        {section.categories.map((c) => (
          <MenuLink key={c.slug} url={c.url} className="group flex flex-col items-center gap-3 text-center">
            <span className="block aspect-square w-full overflow-hidden rounded-full border-4 border-sf-surface bg-sf-surface shadow-sm transition group-hover:border-sf-accent">
              {c.image ? (
                <MediaImage media={c.image} alt="" sizes="144px" className="size-full object-cover" />
              ) : (
                <span aria-hidden className="grid size-full place-items-center bg-sf-accent/10 font-heading text-4xl font-extrabold text-sf-accent">
                  {c.name.slice(0, 1).toUpperCase()}
                </span>
              )}
            </span>
            <span>
              <span className="block font-heading font-bold text-sf-heading group-hover:text-sf-accent">{c.name}</span>
              <span className="block text-xs">{t('content.section.productCount', { count: c.product_count })}</span>
            </span>
          </MenuLink>
        ))}
      </Rail>
    </section>
  )
}

export function BrandStrip({ section }: { section: Extract<StoreSection, { type: 'brand_strip' }> }) {
  const { t } = useLocale()
  const label = section.title ?? t('content.section.ourBrands')

  return (
    <section className="mx-auto w-full max-w-sf px-4 py-10" aria-label={label}>
      <SectionHeading section={section} />
      <Rail label={label} count={section.brands.length} itemClassName="w-36 sm:w-44" centerWhenFits>
        {section.brands.map((b) => (
          <MenuLink
            key={b.slug}
            url={b.url}
            className="group grid h-24 place-items-center rounded-sf-card border bg-sf-surface p-4 transition hover:border-sf-accent hover:shadow-md"
            aria-label={b.name}
          >
            {b.logo ? (
              <MediaImage media={b.logo} alt="" sizes="176px" className="max-h-16 w-auto object-contain grayscale transition group-hover:grayscale-0 group-focus-visible:grayscale-0" />
            ) : (
              <span className="font-heading text-lg font-bold text-sf-heading">{b.name}</span>
            )}
          </MenuLink>
        ))}
      </Rail>
    </section>
  )
}
