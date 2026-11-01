import { useState } from 'react'
import { Link } from 'react-router'
import { FolderTreeIcon, ImageIcon, PlusIcon, SearchIcon } from 'lucide-react'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth } from '@/features/auth/use-auth'
import { useBlogCategoriesQuery, useBlogPostsQuery, type BlogPostSummary } from '@/features/content/api'
import { authorName, BLOG_TABS, type BlogTab } from '@/features/content/blog'
import { BlogCategoriesDialog } from '@/features/content/components/blog-categories-dialog'
import { BlogStateBadge } from '@/features/content/components/blog-state-badge'
import { ContentHeader } from '@/features/content/components/content-header'
import { useDebouncedValue } from '@/lib/use-debounced-value'

const ALL = 'all'
const NONE = 'none'

function formatWhen(iso: string | null, timeZone: string | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  try {
    return date.toLocaleString(undefined, { timeZone, dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return date.toLocaleString()
  }
}

function Cover({ post }: { post: BlogPostSummary }) {
  return (
    <span className="flex h-10 w-14 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted">
      {post.cover?.url ? <img src={post.cover.url} alt="" className="size-full object-cover" /> : <ImageIcon className="size-4 text-muted-foreground" aria-hidden />}
    </span>
  )
}

/** /content/blog — posts by state and category, with the category manager. */
export function BlogPostsPage() {
  const me = useAuth()
  const timeZone = me.organization?.timezone
  const [tab, setTab] = useState<BlogTab>('all')
  const [categoryId, setCategoryId] = useState<string>(ALL)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [managing, setManaging] = useState(false)
  const debounced = useDebouncedValue(search, 300)
  const categories = useBlogCategoriesQuery()
  const posts = useBlogPostsQuery({
    page,
    search: debounced || undefined,
    status: tab === 'all' ? undefined : tab,
    category_id: categoryId === ALL ? undefined : categoryId,
  })
  const counts = posts.data?.counts
  const filtered = debounced !== '' || tab !== 'all' || categoryId !== ALL

  return (
    <div className="flex flex-col gap-6">
      <ContentHeader
        actions={
          <>
            <Button variant="outline" onClick={() => setManaging(true)}><FolderTreeIcon data-icon="inline-start" /> Categories</Button>
            <Button asChild>
              <Link to="/content/blog/new"><PlusIcon data-icon="inline-start" /> New post</Link>
            </Button>
          </>
        }
      />

      <Card>
        <CardContent className="flex flex-col gap-4">
          <Tabs
            value={tab}
            onValueChange={(v) => {
              setTab(v as BlogTab)
              setPage(1)
            }}
          >
            <TabsList aria-label="Post status" className="max-w-full overflow-x-auto">
              {BLOG_TABS.map((t) => {
                const count = counts?.[t.value]
                return <TabsTrigger key={t.value} value={t.value}>{t.label}{count !== undefined ? ` (${count})` : ''}</TabsTrigger>
              })}
            </TabsList>
          </Tabs>
          <div className="flex flex-wrap gap-3">
            <div className="relative min-w-56 flex-1">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Search by title or address"
                aria-label="Search posts"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(1)
                }}
              />
            </div>
            <Select
              value={categoryId}
              onValueChange={(v) => {
                setCategoryId(v)
                setPage(1)
              }}
            >
              <SelectTrigger aria-label="Category" className="w-full sm:w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All categories</SelectItem>
                {(categories.data ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                <SelectItem value={NONE}>Uncategorised</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {posts.isPending ? (
            <LoadingState label="Loading posts" />
          ) : posts.error ? (
            <ErrorState error={posts.error} onRetry={() => posts.refetch()} />
          ) : posts.data.items.length === 0 ? (
            <EmptyState
              title={filtered ? 'No matching posts' : 'No posts yet'}
              description="Blog posts appear on /blog, in their category and in the homepage blog section."
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Post</TableHead>
                    <TableHead className="hidden md:table-cell">Category</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden lg:table-cell">Author</TableHead>
                    <TableHead className="hidden md:table-cell">Publish date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {posts.data.items.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Cover post={p} />
                          <div className="min-w-0">
                            <Link to={`/content/blog/${p.id}`} className="font-medium hover:underline">{p.title}</Link>
                            <p className="truncate font-mono text-xs text-muted-foreground">/blog/{p.slug}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden text-sm md:table-cell">{p.category?.name ?? <span className="text-muted-foreground">Uncategorised</span>}</TableCell>
                      <TableCell><BlogStateBadge state={p.state} /></TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">{authorName(p) ?? '—'}</TableCell>
                      <TableCell className="hidden text-sm whitespace-nowrap text-muted-foreground md:table-cell">{p.state === 'draft' ? '—' : formatWhen(p.published_at, timeZone)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <PaginationBar pagination={posts.data.pagination} onPageChange={setPage} />
            </>
          )}
        </CardContent>
      </Card>

      <BlogCategoriesDialog open={managing} onOpenChange={setManaging} />
    </div>
  )
}
