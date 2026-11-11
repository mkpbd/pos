import { Link } from 'react-router'
import { CalendarIcon, ClockIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MediaImage } from '../components/media-image'
import { useLocale } from '../i18n/locale'
import type { BlogPostRow } from '../types'
import { blogCategoryUrl, blogPostUrl, formatPostDate, readingTimeLabel } from './display'

/** Category chip linking to the category's post list. */
export function CategoryChip({ category, className }: { category: { name: string; slug: string }; className?: string }) {
  return (
    <Link
      to={blogCategoryUrl(category.slug)}
      className={cn('inline-flex rounded-full bg-sf-accent/10 px-3 py-1 text-xs font-semibold text-sf-accent transition hover:bg-sf-accent hover:text-sf-accent-foreground', className)}
    >
      {category.name}
    </Link>
  )
}

/** Date and reading time, e.g. "October 12, 2026 · 4 min read". */
export function PostMeta({ post, className }: { post: Pick<BlogPostRow, 'published_at' | 'reading_minutes' | 'author'>; className?: string }) {
  const { t } = useLocale()
  const date = formatPostDate(post.published_at)
  return (
    <p className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 text-sm', className)}>
      {date && (
        <span className="inline-flex items-center gap-1.5">
          <CalendarIcon aria-hidden className="size-4" />
          <time dateTime={post.published_at}>{date}</time>
        </span>
      )}
      <span className="inline-flex items-center gap-1.5">
        <ClockIcon aria-hidden className="size-4" />
        {readingTimeLabel(post.reading_minutes, t)}
      </span>
      {post.author && <span>{t('blog.by', { author: post.author })}</span>}
    </p>
  )
}

/** A post in a grid: cover, category chip, title, meta line and excerpt. */
export function BlogCard({ post, headingLevel = 2 }: { post: BlogPostRow; headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3'
  const url = blogPostUrl(post.slug)

  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-sf-card bg-sf-surface shadow-sm transition hover:shadow-md" data-testid="blog-card">
      {post.cover && (
        // The title link carries the name; the image link is a mouse convenience only.
        <Link to={url} tabIndex={-1} aria-hidden className="block aspect-[16/9] overflow-hidden bg-sf-canvas">
          <MediaImage
            media={post.cover}
            alt=""
            sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
            className="size-full object-cover transition-transform duration-500 group-hover:scale-105 motion-reduce:transition-none"
          />
        </Link>
      )}
      <div className="flex flex-1 flex-col gap-3 p-5">
        {post.category && (
          <div>
            <CategoryChip category={post.category} />
          </div>
        )}
        <Heading className="text-xl leading-snug font-bold">
          <Link to={url} className="text-sf-heading transition-colors hover:text-sf-accent hover:underline">
            {post.title}
          </Link>
        </Heading>
        <PostMeta post={{ ...post, author: null }} />
        {post.excerpt && <p className="line-clamp-3">{post.excerpt}</p>}
      </div>
    </article>
  )
}

/** Cards in a responsive grid (one, two, then three columns). */
/**
 * Posts in up to three columns (exactly three: one row from md, not two plus an orphan). `centered` (under a centred heading, e.g. related posts) keeps the
 * column width but centres a short last row instead of leaving a gap on the right.
 */
export function BlogGrid({ posts, headingLevel = 2, label, centered = false }: { posts: BlogPostRow[]; headingLevel?: 2 | 3; label?: string; centered?: boolean }) {
  return (
    <ul className={centered ? 'flex flex-wrap justify-center gap-6' : cn('grid gap-6', posts.length === 3 ? 'md:grid-cols-3' : 'sm:grid-cols-2 lg:grid-cols-3')} aria-label={label}>
      {posts.map((post) => (
        <li key={post.slug} className={centered ? 'w-full sm:w-[calc((100%-1.5rem)/2)] md:w-[calc((100%-3rem)/3)]' : undefined}>
          <BlogCard post={post} headingLevel={headingLevel} />
        </li>
      ))}
    </ul>
  )
}
