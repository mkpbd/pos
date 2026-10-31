import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowRightIcon, FlameIcon } from 'lucide-react'
import { storefrontKeys } from '../api'
import { ProductCard } from '../catalog/product-card'
import { PRODUCT_RAIL_ITEM, Rail } from '../catalog/product-rail'
import { MenuLink } from '../components/menu-link'
import { Countdown } from '../promotions/countdown-timer'
import { useDeadline } from '../promotions/countdown'
import type { StoreSection } from '../types'

type Props = { section: Extract<StoreSection, { type: 'hot_deals' }> }

/**
 * Flash sales: a heading with a big countdown to the earliest end among the promotions shown,
 * and their products as a rail of cards. When the countdown reaches zero the section hides
 * itself and the homepage is fetched again (the server then sends what is still on). A card
 * whose promotion ends with the section does not repeat the countdown.
 */
export function HotDealsSection({ section }: Props) {
  const queryClient = useQueryClient()
  const { expired } = useDeadline(section.ends_at)
  const title = section.title ?? 'Hot deals'

  useEffect(() => {
    // Once per end: the next homepage no longer has these deals (or has the next ones).
    if (expired) void queryClient.invalidateQueries({ queryKey: storefrontKeys.homepageAll })
  }, [expired, queryClient])

  if (expired || section.products.length === 0) return null

  return (
    <section className="mx-auto w-full max-w-sf px-4 py-10" aria-labelledby={`hot-deals-${section.id}`} data-testid="hot-deals">
      <div className="rounded-sf-card bg-sf-sale/5 p-5 md:p-8">
        <header className="mb-6 flex flex-col items-center gap-4 text-center sm:flex-row sm:items-end sm:justify-between sm:text-left">
          <div>
            <h2 id={`hot-deals-${section.id}`} className="inline-flex items-center gap-2 text-3xl font-extrabold lg:text-4xl">
              <FlameIcon aria-hidden className="size-8 text-sf-sale" />
              {title}
            </h2>
            {section.subtitle && <p className="mt-2 max-w-2xl">{section.subtitle}</p>}
          </div>
          {section.ends_at && <Countdown endsAt={section.ends_at} variant="large" prefix="Ends in" />}
        </header>
        <Rail label={title} count={section.products.length} itemClassName={PRODUCT_RAIL_ITEM}>
          {section.products.map((product) => (
            <ProductCard key={product.id} product={product} countdown={product.promotion?.ends_at !== section.ends_at} />
          ))}
        </Rail>
        {section.config.view_all_url && (
          <div className="mt-6 text-center">
            <MenuLink
              url={section.config.view_all_url}
              className="inline-flex items-center gap-2 rounded-sf-button bg-sf-primary px-6 py-3 text-sm font-bold tracking-wide text-sf-primary-foreground uppercase transition hover:brightness-105"
            >
              View all deals
              <ArrowRightIcon aria-hidden className="size-4" />
            </MenuLink>
          </div>
        )}
      </div>
    </section>
  )
}
