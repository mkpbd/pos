import { useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellIcon, CheckCheckIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { api } from '@/lib/api/client'
import { cn } from '@/lib/utils'

type AppNotification = {
  id: string
  type: string
  data: { title?: string; message?: string; link?: string }
  read_at: string | null
  created_at: string
}

const keys = { count: ['notifications', 'count'] as const, list: ['notifications', 'list'] as const }

/** In-app inbox: polls the unread count every minute; opens the latest ten. */
export function NotificationBell() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const count = useQuery({
    queryKey: keys.count,
    queryFn: ({ signal }) => api.get<{ count: number }>('/notifications/unread-count', { signal }).then((r) => r.data.count),
    refetchInterval: 60_000,
  })
  const list = useQuery({
    queryKey: keys.list,
    queryFn: ({ signal }) => api.get<AppNotification[]>('/notifications', { signal, query: { per_page: 10 } }).then((r) => r.data),
    enabled: false,
  })
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['notifications'] })
  }
  const markRead = useMutation({ mutationFn: (id: string) => api.post(`/notifications/${id}/read`), onSuccess: refresh })
  const markAll = useMutation({ mutationFn: () => api.post('/notifications/read-all'), onSuccess: refresh })
  const unread = count.data ?? 0

  return (
    <Popover onOpenChange={(open) => open && void list.refetch()}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={unread ? `Notifications (${unread} unread)` : 'Notifications'} className="relative">
          <BellIcon />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">Notifications</span>
          <Button variant="ghost" size="xs" disabled={unread === 0 || markAll.isPending} onClick={() => markAll.mutate()}>
            <CheckCheckIcon data-icon="inline-start" /> Mark all read
          </Button>
        </div>
        <ul className="max-h-96 overflow-y-auto">
          {list.isFetching && !list.data ? (
            <li className="p-4 text-sm text-muted-foreground">Loading…</li>
          ) : (list.data ?? []).length === 0 ? (
            <li className="p-4 text-sm text-muted-foreground">You're all caught up.</li>
          ) : (
            list.data?.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  className={cn('flex w-full flex-col gap-0.5 border-b px-3 py-2 text-left text-sm hover:bg-accent', !n.read_at && 'bg-primary/5')}
                  onClick={() => {
                    if (!n.read_at) markRead.mutate(n.id)
                    if (n.data.link) navigate(n.data.link)
                  }}
                >
                  <span className={cn(!n.read_at && 'font-medium')}>{n.data.title ?? 'Notification'}</span>
                  {n.data.message && <span className="text-xs text-muted-foreground">{n.data.message}</span>}
                  <span className="text-xs text-muted-foreground">{new Date(n.created_at).toLocaleString()}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
