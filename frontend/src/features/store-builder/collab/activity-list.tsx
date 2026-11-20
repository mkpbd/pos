import { useInfiniteQuery } from '@tanstack/react-query'
import { Loader2Icon } from 'lucide-react'
import { ErrorState, LoadingState } from '@/components/common/state-views'
import { Button } from '@/components/ui/button'
import { formatStoreTime } from '../publishing/schedule-time'
import { collabKeys, fetchActivity } from './collab-api'
import { activityVersion, activityWords } from './collab-model'

/*
 * B16: what happened to this page, newest first, in plain words — publishes, plans, approvals,
 * named copies, restores, take-overs, resolved comments and editing sessions ("Rima edited the
 * draft (12 saves, 3:10–3:40 PM)"). Entries about a version link to it.
 */

export function ActivityList({ documentId, enabled, timeZone, onShowVersion }: { documentId: string; enabled: boolean; timeZone?: string; onShowVersion?: (versionId: string) => void }) {
  const query = useInfiniteQuery({
    queryKey: collabKeys.activity(documentId),
    queryFn: ({ pageParam, signal }) => fetchActivity(documentId, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    enabled,
    staleTime: 0,
  })
  if (query.isPending) return <LoadingState rows={3} label="Loading activity" />
  if (query.error) return <ErrorState title="Could not load the activity" error={query.error} onRetry={() => void query.refetch()} />
  const entries = query.data.pages.flatMap((page) => page.entries)
  if (entries.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">Nothing has happened to this page yet.</p>
  return (
    <div className="flex flex-col gap-2">
      <ol className="max-h-[55vh] divide-y overflow-y-auto" aria-label="Activity on this page, newest first" data-testid="activity-list">
        {entries.map((entry) => {
          const version = activityVersion(entry)
          return (
            <li key={entry.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2.5" data-testid="activity-entry">
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  {entry.user ? <span className="font-semibold">{entry.user.name} </span> : null}
                  {activityWords(entry, timeZone)}
                </p>
                <p className="text-xs text-muted-foreground">
                  <time dateTime={entry.at}>{formatStoreTime(entry.at, timeZone)}</time>
                  {typeof entry.details.note === 'string' && entry.details.note.trim() !== '' && ` · “${entry.details.note.trim()}”`}
                </p>
              </div>
              {version && onShowVersion && (
                <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => onShowVersion(version.id)}>
                  {version.number !== null ? `See version ${version.number}` : 'See the version'}
                </Button>
              )}
            </li>
          )
        })}
      </ol>
      {query.hasNextPage && (
        <Button type="button" variant="outline" size="sm" className="self-center" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
          {query.isFetchingNextPage && <Loader2Icon className="animate-spin" aria-hidden />} Show older activity
        </Button>
      )}
    </div>
  )
}
