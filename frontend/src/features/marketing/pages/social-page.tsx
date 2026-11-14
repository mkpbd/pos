import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { PlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { ErrorState, LoadingState } from '@/components/common/state-views'
import { Button } from '@/components/ui/button'
import { useAuth, useCan } from '@/features/auth/use-auth'
import { MarketingHeader } from '@/features/marketing/components/marketing-header'
import { MetaAppCard } from '@/features/marketing/components/meta-app-card'
import { PostComposer } from '@/features/marketing/components/post-composer'
import { SocialConnectionCard } from '@/features/marketing/components/social-connection-card'
import { SocialPostsList } from '@/features/marketing/components/social-posts'
import { outcomeMessage, targetList, type SubmitIntent } from '@/features/marketing/social'
import {
  isPublishing,
  SOCIAL_MANAGE,
  socialKeys,
  useSocialAccountsQuery,
  useSocialSettingsQuery,
  useWatchedPostsQueries,
  type SocialPost,
} from '@/features/marketing/social-api'
import { formatDateTime } from '@/features/web-orders/orders'

function announce(post: SocialPost) {
  const outcome = outcomeMessage(post)
  if (!outcome) return
  if (outcome.kind === 'success') toast.success(outcome.text)
  else if (outcome.kind === 'warning') toast.warning(outcome.text)
  else toast.error(outcome.text)
}

/**
 * /marketing/social — Facebook & Instagram: the connection (practice or live), the post list and the
 * composer, and the Meta app settings. `?connected=1` / `?error=<code>` come back from the connection.
 */
export function SocialPage() {
  const me = useAuth()
  const canManage = useCan()(SOCIAL_MANAGE)
  const timeZone = me.organization?.timezone
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const settings = useSocialSettingsQuery()
  const accounts = useSocialAccountsQuery()
  const [connectError, setConnectError] = useState<string | null>(() => searchParams.get('error'))
  const [composing, setComposing] = useState<SocialPost | 'new' | null>(null)
  const [watching, setWatching] = useState<string[]>([])
  const watched = useWatchedPostsQueries(watching)
  const handled = useRef(false)
  const announced = useRef(new Set<string>())

  // The connection comes back with ?connected=1 or ?error=<code>: say so once and tidy the address.
  useEffect(() => {
    if (handled.current) return
    const connected = searchParams.get('connected')
    const error = searchParams.get('error')
    if (!connected && !error) return
    handled.current = true
    if (connected) toast.success('Facebook is connected. You can post now.')
    const next = new URLSearchParams(searchParams)
    next.delete('connected')
    next.delete('error')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  // Posts sent off with a queue worker: announce each once it settles (settled queries stop polling).
  useEffect(() => {
    let changed = false
    for (const post of watched.map((q) => q.data)) {
      if (!post || isPublishing(post) || announced.current.has(post.id)) continue
      announced.current.add(post.id)
      announce(post)
      changed = true
    }
    if (changed) void queryClient.invalidateQueries({ queryKey: [...socialKeys.posts, 'list'] })
  }, [watched, queryClient])

  const track = (post: SocialPost) => {
    if (isPublishing(post)) {
      toast.message(`Posting to ${targetList(post.targets)}…`)
      announced.current.delete(post.id)
      setWatching((ids) => (ids.includes(post.id) ? ids : [...ids, post.id]))
    } else announce(post)
  }

  const onSubmitted = (post: SocialPost, intent: SubmitIntent) => {
    if (intent === 'draft') toast.success('Draft saved.')
    else if (intent === 'schedule') toast.success(`Scheduled for ${formatDateTime(post.scheduled_at, timeZone)}.`)
    else track(post)
  }

  const connected = !!accounts.data?.connected

  return (
    <div className="flex flex-col gap-6">
      <MarketingHeader
        actions={
          canManage &&
          connected && (
            <Button onClick={() => setComposing('new')}>
              <PlusIcon data-icon="inline-start" /> New post
            </Button>
          )
        }
      />

      {accounts.isPending || settings.isPending ? (
        <LoadingState rows={3} label="Loading Facebook and Instagram" />
      ) : accounts.error || settings.error ? (
        <ErrorState error={accounts.error ?? settings.error} onRetry={() => void Promise.all([accounts.refetch(), settings.refetch()])} />
      ) : (
        <>
          <SocialConnectionCard
            accounts={accounts.data}
            liveReady={settings.data.live_ready}
            canManage={canManage}
            timeZone={timeZone}
            connectError={connectError}
            onDismissError={() => setConnectError(null)}
          />
          <SocialPostsList canManage={canManage} timeZone={timeZone} onEdit={(post) => setComposing(post)} onTrack={track} />
          {canManage && (
            <MetaAppCard
              key={`${settings.data.mode}|${settings.data.meta_app_id}|${settings.data.secret_set}|${settings.data.graph_version}`}
              settings={settings.data}
              connectedPage={accounts.data.connected ? (accounts.data.page?.name ?? null) : null}
            />
          )}
        </>
      )}

      {composing && accounts.data && (
        <PostComposer
          key={composing === 'new' ? 'new' : composing.id}
          post={composing === 'new' ? null : composing}
          accounts={accounts.data}
          timeZone={timeZone}
          onClose={() => setComposing(null)}
          onSubmitted={onSubmitted}
        />
      )}
    </div>
  )
}
