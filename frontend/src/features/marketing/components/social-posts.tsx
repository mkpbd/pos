import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { CalendarXIcon, ExternalLinkIcon, ImageIcon, Loader2Icon, PencilIcon, RotateCwIcon, SendIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { NetworkIcon } from '@/features/marketing/components/network-icon'
import { POST_FILTERS, POST_STATUS, postErrorText, resultErrorText, resultLabel, TARGET_LABELS, targetList } from '@/features/marketing/social'
import {
  SOCIAL_POST_STATUSES,
  useDeleteSocialPostMutation,
  useSocialPostActionMutation,
  useSocialPostsQuery,
  type SocialPost,
  type SocialPostResult,
  type SocialPostStatus,
} from '@/features/marketing/social-api'
import { formatDateTime } from '@/features/web-orders/orders'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { cn } from '@/lib/utils'

const ALL = '__all__'

function whenText(post: SocialPost, timeZone: string | undefined): string {
  switch (post.status) {
    case 'draft':
      return 'Draft — not scheduled'
    case 'scheduled':
      return `Posts ${formatDateTime(post.scheduled_at, timeZone)}`
    case 'publishing':
      return 'Posting now…'
    case 'published':
    case 'partially_published':
      return `Posted ${formatDateTime(post.published_at ?? post.updated_at, timeZone)}`
    case 'failed':
      return `Tried ${formatDateTime(post.updated_at, timeZone)}`
  }
}

function ResultLine({ result, post }: { result: SocialPostResult; post: SocialPost }) {
  const label = resultLabel(result, post.status)
  const network = TARGET_LABELS[result.target]
  return (
    <li className="flex flex-wrap items-start gap-x-2 gap-y-1 text-sm" data-testid={`result-${result.target}`}>
      <span className="inline-flex items-center gap-1.5 font-medium">
        <NetworkIcon target={result.target} /> {network}:
      </span>
      <span className={cn(result.status === 'published' && 'text-success-soft-foreground', result.status === 'failed' && 'text-destructive')}>
        {result.status === 'publishing' && <Loader2Icon className="mr-1 inline size-3.5 animate-spin" aria-hidden />}
        {label}
        {result.status === 'failed' && ` — ${resultErrorText(result.error)}`}
      </span>
      {result.permalink &&
        (result.sandbox ? (
          // Practice permalinks (https://sandbox.invalid/…) never open: text, not a link.
          <span className="text-muted-foreground" data-testid={`practice-${result.target}`}>
            Practice post — not on {network} <span className="font-mono text-xs break-all">({result.permalink})</span>
          </span>
        ) : (
          <a href={result.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline">
            View on {network} <ExternalLinkIcon className="size-3.5" aria-hidden />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        ))}
      {result.short_link && (
        <span className="font-mono text-xs text-muted-foreground" title={result.short_link.url ?? undefined}>
          /go/{result.short_link.code}
        </span>
      )}
    </li>
  )
}

type Confirm = { kind: 'publish' | 'delete'; post: SocialPost }

type Props = {
  canManage: boolean
  timeZone: string | undefined
  onEdit: (post: SocialPost) => void
  /** A post was sent off (publish / retry): the page announces or watches it. */
  onTrack: (post: SocialPost) => void
}

/** The post list with its status filter and search; actions follow each post's `allowed_actions`. */
export function SocialPostsList({ canManage, timeZone, onEdit, onTrack }: Props) {
  const [searchParams, setSearchParams] = useSearchParams()
  const statusParam = searchParams.get('status') ?? ''
  const status = (SOCIAL_POST_STATUSES as readonly string[]).includes(statusParam) ? (statusParam as SocialPostStatus) : undefined
  const page = Math.max(1, Number(searchParams.get('page')) || 1)
  const [search, setSearch] = useState('')
  const term = useDebouncedValue(search.trim())
  const posts = useSocialPostsQuery({ page, ...(status ? { status } : {}), ...(term ? { search: term } : {}) })
  const action = useSocialPostActionMutation()
  const remove = useDeleteSocialPostMutation()
  const [confirm, setConfirm] = useState<Confirm | null>(null)

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams)
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) next.delete(k)
      else next.set(k, v)
    }
    setSearchParams(next, { replace: true })
  }

  const run = (post: SocialPost, kind: 'publish' | 'cancel' | 'retry') =>
    action.mutate(
      { id: post.id, action: kind },
      {
        onSuccess: (saved) => {
          if (kind === 'cancel') toast.success('The schedule is cancelled. The post is a draft again.')
          else onTrack(saved)
        },
        onError: (e) => toast.error(postErrorText(e)),
        onSettled: () => setConfirm(null),
      },
    )

  const rows = posts.data?.items ?? []
  const filtered = !!status || !!term

  return (
    <section aria-labelledby="social-posts-title" className="flex flex-col gap-4">
      <h2 id="social-posts-title" className="font-heading text-lg font-semibold">Posts</h2>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="social-post-filter">Show</Label>
          <Select value={status ?? ALL} onValueChange={(v) => update({ status: v === ALL ? null : v, page: null })}>
            <SelectTrigger id="social-post-filter" className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              {POST_FILTERS.map((f) => <SelectItem key={f.value || ALL} value={f.value || ALL}>{f.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Input
          aria-label="Search posts"
          placeholder="Search captions"
          className="w-full sm:max-w-xs"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            if (page !== 1) update({ page: null })
          }}
        />
      </div>

      {posts.isPending ? (
        <LoadingState rows={3} label="Loading posts" />
      ) : posts.error ? (
        <ErrorState error={posts.error} onRetry={() => void posts.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={filtered ? 'No posts match' : 'No posts yet'}
          description={filtered ? undefined : 'Pick a product, choose photos and a caption, then post now or schedule it for later.'}
        />
      ) : (
        <>
          <ul aria-label="Posts" className="flex flex-col gap-3">
            {rows.map((post) => {
              const badge = POST_STATUS[post.status] ?? { label: post.status, variant: 'outline' as const }
              const allowed = canManage ? post.allowed_actions : []
              const cover = post.media[0]
              const practice = post.results.some((r) => r.sandbox)
              return (
                <li key={post.id} data-testid={`social-post-${post.id}`} className="flex gap-3 rounded-lg border bg-card p-3 sm:p-4">
                  <span className="relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted sm:size-20">
                    {cover ? <img src={cover.url} alt="" className="size-full object-cover" /> : <ImageIcon className="size-5 text-muted-foreground" aria-hidden />}
                    {post.media.length > 1 && (
                      <span className="absolute right-1 bottom-1 rounded bg-black/70 px-1 text-xs text-white">
                        {post.media.length}
                        <span className="sr-only"> photos</span>
                      </span>
                    )}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                      {practice && <Badge variant="outline">Practice</Badge>}
                      <span className="text-xs text-muted-foreground">{whenText(post, timeZone)}</span>
                    </div>
                    <p className="line-clamp-3 text-sm break-words whitespace-pre-line">{post.caption}</p>
                    <p className="text-xs text-muted-foreground">
                      {targetList(post.targets)}
                      {post.product && ` · Product: ${post.product.name}`}
                      {post.campaign && ` · Campaign: ${post.campaign.name}`}
                      {post.link_url ? ` · Links to ${post.link_url}` : post.product ? ' · Links to the product’s page' : ''}
                    </p>
                    {post.status !== 'draft' && (
                      <ul aria-label="Result on each network" className="flex flex-col gap-1">
                        {post.results.map((r) => <ResultLine key={r.target} result={r} post={post} />)}
                      </ul>
                    )}
                    {allowed.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {allowed.includes('publish') && (
                          <Button size="sm" variant="outline" disabled={action.isPending} onClick={() => setConfirm({ kind: 'publish', post })}>
                            <SendIcon data-icon="inline-start" /> Post now
                          </Button>
                        )}
                        {allowed.includes('retry') && (
                          <Button size="sm" variant="outline" disabled={action.isPending} onClick={() => run(post, 'retry')}>
                            <RotateCwIcon data-icon="inline-start" /> Retry {targetList(post.results.filter((r) => r.status === 'failed').map((r) => r.target)) || 'failed'}
                          </Button>
                        )}
                        {allowed.includes('edit') && (
                          <Button size="sm" variant="ghost" onClick={() => onEdit(post)}>
                            <PencilIcon data-icon="inline-start" /> Edit
                          </Button>
                        )}
                        {allowed.includes('cancel') && (
                          <Button size="sm" variant="ghost" disabled={action.isPending} onClick={() => run(post, 'cancel')}>
                            <CalendarXIcon data-icon="inline-start" /> Cancel schedule
                          </Button>
                        )}
                        {allowed.includes('delete') && (
                          <Button size="sm" variant="ghost" onClick={() => setConfirm({ kind: 'delete', post })}>
                            <Trash2Icon data-icon="inline-start" /> Delete
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
          <PaginationBar pagination={posts.data.pagination} onPageChange={(p) => update({ page: p === 1 ? null : String(p) })} />
        </>
      )}

      <ConfirmDialog
        open={confirm?.kind === 'publish'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Post this now?"
        description={confirm ? `It goes to ${targetList(confirm.post.targets)} right away${confirm.post.status === 'scheduled' ? ' instead of at its scheduled time' : ''}.` : ''}
        confirmLabel="Post now"
        destructive={false}
        pending={action.isPending}
        onConfirm={() => confirm && run(confirm.post, 'publish')}
      />
      <ConfirmDialog
        open={confirm?.kind === 'delete'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Delete this post?"
        description={confirm?.post.status === 'scheduled' ? 'It will not be posted, and it is removed from this list.' : 'It is removed from this list. Nothing on Facebook or Instagram changes.'}
        confirmLabel="Delete"
        pending={remove.isPending}
        onConfirm={() =>
          confirm &&
          remove.mutate(confirm.post.id, {
            onSuccess: () => toast.success('Post deleted.'),
            onError: (e) => toast.error(postErrorText(e)),
            onSettled: () => setConfirm(null),
          })
        }
      />
    </section>
  )
}
