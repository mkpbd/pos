import { useLocale } from '../i18n/locale'
import type { MessageKey } from '../i18n/en'
import type { SectionPreviewState, StoreSection } from '../types'
import { BannerGrid } from './banner-grid'
import { BlogPostsSection } from './blog-posts-section'
import { FeaturesStrip, RichTextSection, Testimonials } from './content-sections'
import { HeroSlider } from './hero-slider'
import { HotDealsSection } from './hot-deals-section'
import { NewsletterStrip } from './newsletter-strip'
import { BrandStrip, CategoryStrip, ProductCarouselSection, ProductGridSection, ProductTabsSection } from './product-sections'

const PREVIEW_LABELS: Record<Exclude<SectionPreviewState, 'live' | 'empty'>, MessageKey> = {
  disabled: 'content.preview.disabled',
  scheduled: 'content.preview.scheduled',
  expired: 'content.preview.expired',
}

/** Why an empty section is not shown, by what it would list. */
function emptyLabel(section: StoreSection): MessageKey {
  switch (section.type) {
    case 'hero_slider':
    case 'banner_grid':
      return 'content.preview.noBanners'
    case 'category_strip':
      return 'content.preview.noCategories'
    case 'brand_strip':
      return 'content.preview.noBrands'
    case 'hot_deals':
      return 'content.preview.noDeals'
    case 'blog_posts':
      return 'content.preview.noPosts'
    default:
      return 'content.preview.noProducts'
  }
}

/** A section without anything to list (only sent in previews). */
function isEmpty(section: StoreSection): boolean {
  switch (section.type) {
    case 'hero_slider':
    case 'banner_grid':
      return section.banners.length === 0
    case 'product_carousel':
    case 'product_grid':
    case 'hot_deals':
      return section.products.length === 0
    case 'product_tabs':
      return section.tabs.every((tab) => tab.products.length === 0)
    case 'category_strip':
      return section.categories.length === 0
    case 'brand_strip':
      return section.brands.length === 0
    case 'blog_posts':
      return section.posts.length === 0
    default:
      return false
  }
}

function Section({ section }: { section: StoreSection }) {
  switch (section.type) {
    case 'hero_slider':
      return <HeroSlider section={section} />
    case 'banner_grid':
      return <BannerGrid section={section} />
    case 'rich_text':
      return <RichTextSection section={section} />
    case 'features_strip':
      return <FeaturesStrip section={section} />
    case 'testimonials':
      return <Testimonials section={section} />
    case 'newsletter':
      return <NewsletterStrip section={section} />
    case 'product_carousel':
      return <ProductCarouselSection section={section} />
    case 'product_grid':
      return <ProductGridSection section={section} />
    case 'product_tabs':
      return <ProductTabsSection section={section} />
    case 'category_strip':
      return <CategoryStrip section={section} />
    case 'brand_strip':
      return <BrandStrip section={section} />
    case 'hot_deals':
      return <HotDealsSection section={section} />
    case 'blog_posts':
      return <BlogPostsSection section={section} />
    default:
      // A type this build does not know yet (newer API): skip it rather than break the page.
      return null
  }
}

/**
 * One homepage section in its frame. In a preview, a section visitors do not see is marked (and an
 * empty one keeps a placeholder); outside previews an empty section draws nothing. The store
 * builder renders its wrapped-section elements through this too (`testId` tells them apart).
 */
export function SectionItem({ section, testId = 'homepage-section' }: { section: StoreSection; testId?: string }) {
  const { t } = useLocale()
  const empty = isEmpty(section)
  const state = section.state && section.state !== 'live' ? section.state : null
  // Outside previews the API never sends empty sections; never draw one regardless.
  if (empty && !state) return null

  return (
    <div data-section-type={section.type} data-testid={testId} className={state ? 'relative opacity-60 outline-2 outline-offset-[-2px] outline-dashed outline-sf-sale' : undefined}>
      {state && (
        <p className="absolute top-2 left-2 z-10 rounded bg-neutral-900 px-2 py-1 text-xs font-semibold text-white">{t(state === 'empty' ? emptyLabel(section) : PREVIEW_LABELS[state])}</p>
      )}
      {empty ? <div className="h-24" aria-hidden /> : <Section section={section} />}
    </div>
  )
}

/** The homepage sections in order. In a preview, sections visitors do not see are marked. */
export function SectionList({ sections }: { sections: StoreSection[] }) {
  return (
    <>
      {sections.map((section) => (
        <SectionItem key={section.id} section={section} />
      ))}
    </>
  )
}
