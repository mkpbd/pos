import { useState } from 'react'
import { Link } from 'react-router'
import { GlobeIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { GlobalUsage } from '../api'
import { usageOfError, useDeleteGlobalMutation, useGlobalsQuery, type GlobalSummary } from '../global-api'
import type { MessageKey } from './messages'
import { lastEdited } from './page-helpers'
import { EditLink, ListRow, StatusBadges } from './page-rows'
import { useScreenText } from './screen-language'
import { ScreenConfirm } from './screen-ui'

/*
 * B9: the "Global sections" group of the start screen — every global section with what it is for,
 * where it is used, its status, Edit, and Delete (only when no page uses it; otherwise the pages to
 * clear first, also when the server answers 409 GLOBAL_IN_USE).
 */

function useUsageLine() {
  const { t, tc } = useScreenText()
  return (used: readonly GlobalUsage[], count: number) => {
    if (count === 0) return t('globals.used.none')
    const names = used.slice(0, 3).map((u) => u.title)
    const more = count - names.length
    const list = more > 0 ? t('globals.more', { names: names.join(', '), count: more }) : names.join(', ')
    return tc('globals.used', count, { names: list })
  }
}

function GlobalRow({ summary, canManage, onDelete }: { summary: GlobalSummary; canManage: boolean; onDelete: () => void }) {
  const { t, lang } = useScreenText()
  const usage = useUsageLine()
  return (
    <ListRow
      testId={`global-row-${summary.id}`}
      title={
        <span className="flex flex-wrap items-center gap-2">
          {summary.title}
          <Badge variant="outline">{t(`globals.context.${summary.context}` as MessageKey)}</Badge>
        </span>
      }
      detail={
        <>
          {usage(summary.used_in, summary.usage_count)} · {lastEdited(summary, lang)}
        </>
      }
      status={<StatusBadges summary={summary} />}
    >
      {canManage && <EditLink summary={summary} name={summary.title} />}
      {canManage && (
        <Button variant="ghost" size="icon-sm" aria-label={t('globals.deleteAria', { name: summary.title })} title={t('globals.deleteHint')} onClick={onDelete}>
          <Trash2Icon />
        </Button>
      )}
    </ListRow>
  )
}

export function GlobalSectionsCard({ canManage }: { canManage: boolean }) {
  const { t, lang } = useScreenText()
  const query = useGlobalsQuery()
  const remove = useDeleteGlobalMutation()
  const [deleting, setDeleting] = useState<GlobalSummary | null>(null)
  const [inUse, setInUse] = useState<{ name: string; used: GlobalUsage[] } | null>(null)

  const askDelete = (summary: GlobalSummary) => {
    if (summary.usage_count > 0) setInUse({ name: summary.title, used: summary.used_in })
    else setDeleting(summary)
  }

  return (
    <Card>
      <CardContent>
        {query.isPending ? (
          <LoadingState rows={2} label={t('globals.loading')} />
        ) : query.error ? (
          <ErrorState title={t('globals.error')} error={query.error} onRetry={() => void query.refetch()} />
        ) : query.data.length === 0 ? (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <GlobeIcon className="mt-0.5 size-4 shrink-0" aria-hidden /> {t('globals.empty')}
          </p>
        ) : (
          <ul className="divide-y" aria-label={t('globals.listLabel')}>
            {query.data.map((summary) => (
              <GlobalRow key={summary.id} summary={summary} canManage={canManage} onDelete={() => askDelete(summary)} />
            ))}
          </ul>
        )}
      </CardContent>
      <ScreenConfirm
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('globals.deleteTitle', { name: deleting?.title ?? '' })}
        description={t('globals.deleteText')}
        confirmLabel={t('globals.deleteConfirm')}
        pending={remove.isPending}
        onConfirm={() => {
          if (!deleting) return
          const target = deleting
          remove.mutate(target.id, {
            onSuccess: () => {
              toast.success(t('globals.deleted'))
              setDeleting(null)
            },
            onError: (error) => {
              setDeleting(null)
              const used = usageOfError(error)
              if (used.length > 0) setInUse({ name: target.title, used })
              else toast.error(error.message)
            },
          })
        }}
      />
      <Dialog open={inUse !== null} onOpenChange={(open) => !open && setInUse(null)}>
        <DialogContent lang={lang}>
          <DialogHeader>
            <DialogTitle>{t('globals.inUseTitle', { name: inUse?.name ?? '' })}</DialogTitle>
            <DialogDescription>{t('globals.inUseText')}</DialogDescription>
          </DialogHeader>
          <ul className="flex flex-col gap-1 text-sm" data-testid="global-in-use">
            {inUse?.used.map((u) => (
              <li key={u.id}>
                <Link to={`/storefront/builder/${u.id}`} className="underline underline-offset-2">
                  {u.title}
                </Link>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setInUse(null)}>
              {t('common.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
