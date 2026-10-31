import type { SectionPreviewState, StoreSection } from '../types'
import { BannerGrid } from './banner-grid'
import { FeaturesStrip, RichTextSection, Testimonials } from './content-sections'
import { HeroSlider } from './hero-slider'
import { NewsletterStrip } from './newsletter-strip'

const PREVIEW_LABELS: Record<Exclude<SectionPreviewState, 'live'>, string> = {
  disabled: 'Hidden — visitors do not see this section',
  scheduled: 'Scheduled — not shown yet',
  expired: 'Ended — no longer shown',
  empty: 'No live banners — visitors do not see this section',
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
    default:
      // A type this build does not know yet (newer API): skip it rather than break the page.
      return null
  }
}

/** The homepage sections in order. In a preview, sections visitors do not see are marked. */
export function SectionList({ sections }: { sections: StoreSection[] }) {
  return (
    <>
      {sections.map((section) => {
        const hasBanners = 'banners' in section
        const state = section.state && section.state !== 'live' ? section.state : null

        return (
          <div key={section.id} data-section-type={section.type} data-testid="homepage-section" className={state ? 'relative opacity-60 outline-2 outline-offset-[-2px] outline-dashed outline-sf-sale' : undefined}>
            {state && (
              <p className="absolute top-2 left-2 z-10 rounded bg-neutral-900 px-2 py-1 text-xs font-semibold text-white">{PREVIEW_LABELS[state]}</p>
            )}
            {hasBanners && section.banners.length === 0 ? <div className="h-24" aria-hidden /> : <Section section={section} />}
          </div>
        )
      })}
    </>
  )
}
