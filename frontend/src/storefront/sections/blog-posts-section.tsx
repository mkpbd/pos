import { ArrowRightIcon } from 'lucide-react'
import { BlogGrid } from '../blog/blog-card'
import { MenuLink } from '../components/menu-link'
import { useLocale } from '../i18n/locale'
import type { StoreSection } from '../types'
import { SectionHeading } from './section-heading'

/** Homepage blog teaser: the latest posts (optionally of one category) and a link to the blog. */
export function BlogPostsSection({ section }: { section: Extract<StoreSection, { type: 'blog_posts' }> }) {
  const { t } = useLocale()
  const label = section.title ?? t('content.section.fromBlog')
  const viewAll = section.config.view_all_url || '/blog'

  return (
    <section className="mx-auto w-full max-w-sf px-4 py-10" aria-label={label}>
      <SectionHeading section={section} />
      <BlogGrid posts={section.posts} headingLevel={section.title ? 3 : 2} label={label} />
      <div className="mt-6 text-center">
        <MenuLink
          url={viewAll}
          className="inline-flex items-center gap-2 rounded-sf-button bg-sf-primary px-6 py-3 text-sm font-bold tracking-wide text-sf-primary-foreground uppercase transition hover:brightness-105"
        >
          {t('content.section.viewAllPosts')}
          <ArrowRightIcon aria-hidden className="size-4" />
        </MenuLink>
      </div>
    </section>
  )
}
