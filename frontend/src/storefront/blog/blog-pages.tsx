import type { ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { ArrowLeftIcon, ArrowRightIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import { Breadcrumbs } from '../catalog/breadcrumbs'
import { Pagination } from '../catalog/listing-toolbar'
import { MediaImage } from '../components/media-image'
import { RichText } from '../components/rich-text'
import { NotFoundPage } from '../pages/not-found-page'
import type { BlogCategory, Breadcrumb } from '../types'
import { useDocumentMeta } from '../use-document-meta'
import { useBlogCategoriesQuery, useBlogListQuery, useBlogPostQuery } from './api'
import { BlogGrid, CategoryChip, PostMeta } from './blog-card'
import { blogCategoryUrl, blogListUrl, blogPostUrl, parsePage } from './display'

function Loading() {
  return (
    <div role="status" className="grid min-h-[50vh] place-items-center">
      <span className="size-10 animate-spin rounded-full border-4 border-sf-border border-t-sf-accent motion-reduce:animate-none" aria-hidden />
      <span className="sr-only">Loading</span>
    </div>
  )
}

function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <section className="mx-auto max-w-sf px-4 py-16 text-center">
      <h1 className="text-2xl font-bold">This page could not be loaded</h1>
      <Button className="mt-4 rounded-sf-button" onClick={onRetry}>Try again</Button>
    </section>
  )
}

const isNotFound = (error: unknown) => error instanceof ApiError && error.status === 404

/** The page title band with its breadcrumb trail (the last crumb is the current page). */
function TitleBand({ title, crumbs, children }: { title: string; crumbs: Breadcrumb[]; children?: ReactNode }) {
  return (
    <div className="bg-sf-surface">
      <div className="mx-auto flex max-w-sf flex-col items-center gap-2 px-4 py-10 text-center">
        <h1 className="text-3xl font-extrabold lg:text-4xl">{title}</h1>
        <Breadcrumbs items={crumbs} className="[&_ol]:justify-center" />
        {children}
      </div>
    </div>
  )
}

/** "All posts" plus one chip per category with published posts; the current one is marked. */
function CategoryChips({ categories, current }: { categories: BlogCategory[]; current: string | null }) {
  if (categories.length === 0) return null
  const chip = (active: boolean) =>
    cn(
      'inline-flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm font-semibold transition',
      active ? 'border-sf-primary bg-sf-primary text-sf-primary-foreground' : 'bg-sf-surface hover:border-sf-accent hover:text-sf-accent',
    )

  return (
    <nav aria-label="Blog categories" className="mb-8">
      <ul className="flex flex-wrap justify-center gap-2">
        <li>
          <Link to="/blog" className={chip(current === null)} aria-current={current === null ? 'page' : undefined}>
            All posts
          </Link>
        </li>
        {categories.map((c) => (
          <li key={c.slug}>
            <Link to={blogCategoryUrl(c.slug)} className={chip(current === c.slug)} aria-current={current === c.slug ? 'page' : undefined}>
              {c.name}{' '}
              <span className="text-xs opacity-80">({c.post_count})</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

/** /blog and /blog/category/:slug — published posts, newest first, nine per page (`?page=`). */
export function BlogIndexPage() {
  const { slug } = useParams()
  const category = slug ?? null
  const [params] = useSearchParams()
  const page = parsePage(params.get('page'))
  const categories = useBlogCategoriesQuery()
  const list = useBlogListQuery(category, page)

  // The listing names its category (`meta.category`) even before it has published posts (a menu
  // may link to it); the chips only list categories with posts. An unknown slug is a 404 from the API.
  const listed = list.data?.category?.slug === category ? list.data?.category : undefined
  const current = category ? (categories.data?.find((c) => c.slug === category) ?? listed ?? undefined) : undefined
  const title = category ? (current?.name ?? null) : 'Blog'
  useDocumentMeta(title === null || isNotFound(list.error) ? null : { title, description: current?.description })

  if (isNotFound(list.error)) return <NotFoundPage />
  if (list.error) return <LoadError onRetry={() => void list.refetch()} />
  if (!list.data || (category && !current)) return <Loading />

  const { posts, pagination } = list.data
  const crumbs: Breadcrumb[] = current ? [{ name: 'Home', url: '/' }, { name: 'Blog', url: '/blog' }, { name: current.name, url: null }] : [{ name: 'Home', url: '/' }, { name: 'Blog', url: null }]

  return (
    <div>
      <TitleBand title={title ?? 'Blog'} crumbs={crumbs}>
        {current?.description && <p className="mx-auto max-w-2xl">{current.description}</p>}
      </TitleBand>
      <div className="mx-auto max-w-sf px-4 py-12">
        <CategoryChips categories={categories.data ?? []} current={category} />
        {posts.length > 0 ? (
          <div aria-busy={list.isPlaceholderData || undefined} className={cn(list.isPlaceholderData && 'opacity-60')}>
            <BlogGrid posts={posts} label={current ? `Posts in ${current.name}` : 'Blog posts'} />
          </div>
        ) : (
          <div className="rounded-sf-card bg-sf-surface px-6 py-12 text-center">
            {page > 1 ? (
              <>
                <h2 className="text-xl font-bold">There are no posts on this page</h2>
                <Link to={blogListUrl(category, 1)} className="mt-4 inline-block font-semibold text-sf-accent hover:underline">Go to the first page</Link>
              </>
            ) : (
              <h2 className="text-xl font-bold">No posts have been published yet</h2>
            )}
          </div>
        )}
        <Pagination pagination={pagination} hrefFor={(p) => blogListUrl(category, p)} />
      </div>
    </div>
  )
}

function AdjacentLink({ post, direction }: { post: { slug: string; title: string }; direction: 'prev' | 'next' }) {
  const prev = direction === 'prev'
  return (
    <Link
      to={blogPostUrl(post.slug)}
      rel={prev ? 'prev' : 'next'}
      className={cn('group flex flex-col gap-1 rounded-sf-card bg-sf-surface p-5 transition hover:shadow-md', prev ? 'items-start text-left' : 'items-end text-right sm:col-start-2')}
    >
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase">
        {prev && <ArrowLeftIcon aria-hidden className="size-4" />}
        {prev ? 'Previous post' : 'Next post'}
        {!prev && <ArrowRightIcon aria-hidden className="size-4" />}
      </span>{' '}
      <span className="font-heading font-bold text-sf-heading group-hover:text-sf-accent">{post.title}</span>
    </Link>
  )
}

/** /blog/:slug — one published post (`?preview=1` lets staff see a draft or scheduled post). */
export function BlogPostPage() {
  const { slug = '' } = useParams()
  const [params] = useSearchParams()
  const preview = params.get('preview') === '1'
  const query = useBlogPostQuery(slug, preview)
  const post = query.data
  useDocumentMeta(
    post
      ? {
          title: post.seo_title ?? post.title,
          description: post.seo_description ?? post.excerpt,
          image: post.cover?.url,
          canonical: blogPostUrl(post.slug),
          type: 'article',
          noindex: preview,
        }
      : null,
  )

  if (query.isPending) return <Loading />
  if (isNotFound(query.error)) return <NotFoundPage />
  if (query.error || !post) return <LoadError onRetry={() => void query.refetch()} />

  const crumbs: Breadcrumb[] = [{ name: 'Home', url: '/' }, { name: 'Blog', url: '/blog' }]
  if (post.category) crumbs.push({ name: post.category.name, url: blogCategoryUrl(post.category.slug) })
  crumbs.push({ name: post.title, url: null })
  const related = post.related.slice(0, 3)

  return (
    <div>
      <article className="mx-auto max-w-3xl px-4 py-10">
        <header className="flex flex-col gap-4">
          <Breadcrumbs items={crumbs} />
          {post.category && (
            <div>
              <CategoryChip category={post.category} />
            </div>
          )}
          <h1 className="text-3xl leading-tight font-extrabold lg:text-5xl">{post.title}</h1>
          <PostMeta post={post} />
        </header>
        {post.cover && (
          <MediaImage media={post.cover} alt="" priority sizes="(min-width: 768px) 768px, 100vw" className="mt-8 aspect-[16/9] w-full rounded-sf-card object-cover" />
        )}
        <RichText html={post.body_html} className="mt-8" />
        {post.category && (
          <p className="mt-10 border-t pt-6 text-sm">
            Filed under{' '}
            <Link to={blogCategoryUrl(post.category.slug)} className="font-semibold text-sf-accent hover:underline">
              {post.category.name}
            </Link>
          </p>
        )}
        {(post.prev || post.next) && (
          <nav aria-label="More posts" className="mt-8 grid gap-4 sm:grid-cols-2">
            {post.prev && <AdjacentLink post={post.prev} direction="prev" />}
            {post.next && <AdjacentLink post={post.next} direction="next" />}
          </nav>
        )}
      </article>
      {related.length > 0 && (
        <section aria-labelledby="related-posts" className="bg-sf-surface/60">
          <div className="mx-auto max-w-sf px-4 py-12">
            <h2 id="related-posts" className="mb-8 text-center text-3xl font-extrabold">Related posts</h2>
            <BlogGrid posts={related} headingLevel={3} />
          </div>
        </section>
      )}
    </div>
  )
}
