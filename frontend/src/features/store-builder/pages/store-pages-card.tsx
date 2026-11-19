import { useState } from 'react'
import { FilePlusIcon, Loader2Icon, PaintbrushIcon, StoreIcon, Undo2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { STORE_TEMPLATE_KEYS, type StoreTemplateKey } from '@/storefront/builder/templates/types'
import type { DocumentSummary } from '../api'
import { summaryTemplate, templateCreateInput, useUnpublishTemplateMutation } from '../store-pages-api'
import type { MessageKey } from './messages'
import { lastEdited } from './page-helpers'
import { EditLink, ListRow, StatusBadges, ViewLink } from './page-rows'
import { useScreenText } from './screen-language'
import { ScreenConfirm } from './screen-ui'
import { useStartDocument } from './use-start-document'

/*
 * B14 "Store pages": the shop's own pages (shop, category, brand, search, blog post, order /
 * thank you, page not found) as builder designs. Each row: "Design this page" (from the ready
 * design — an empty one can't be published until it has its main part) or "Start empty" while there is none, else Edit / View and — once published — "Use the
 * standard page" (the design stops showing; its draft stays). Without a published design the
 * store shows its standard page, exactly as before.
 */

/** "Design this page" (from the ready design: the usual way) and "Start empty". */
function DesignButtons({ template, name, disabled, pending, onStart }: { template: StoreTemplateKey; name: string; disabled: boolean; pending: 'starter' | 'blank' | null; onStart: (from: 'starter' | 'blank') => void }) {
  const { t } = useScreenText()
  return (
    <>
      <Button size="sm" variant="outline" disabled={disabled} aria-label={t('store.designAria', { name })} title={t('store.designHint')} data-testid={`design-${template}`} onClick={() => onStart('starter')}>
        {pending === 'starter' ? <Loader2Icon className="animate-spin" aria-hidden /> : <PaintbrushIcon aria-hidden />}
        {t('store.design')}
      </Button>
      <Button size="sm" variant="ghost" disabled={disabled} aria-label={t('store.blankAria', { name })} title={t('store.blankHint')} data-testid={`design-${template}-blank`} onClick={() => onStart('blank')}>
        {pending === 'blank' ? <Loader2Icon className="animate-spin" aria-hidden /> : <FilePlusIcon aria-hidden />}
        {t('store.blank')}
      </Button>
    </>
  )
}

export function StorePagesCard({ documents, canManage, canPublish }: { documents: DocumentSummary[]; canManage: boolean; canPublish: boolean }) {
  const { t, lang } = useScreenText()
  const { start, pendingKey, pending } = useStartDocument()
  const unpublish = useUnpublishTemplateMutation()
  const [confirm, setConfirm] = useState<{ doc: DocumentSummary; name: string } | null>(null)
  const [from, setFrom] = useState<'starter' | 'blank'>('starter')
  const byTemplate = new Map<StoreTemplateKey, DocumentSummary>()
  for (const doc of documents) {
    const template = summaryTemplate(doc)
    if (template && !byTemplate.has(template)) byTemplate.set(template, doc)
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <ul className="divide-y" aria-label={t('store.listLabel')}>
          {STORE_TEMPLATE_KEYS.map((template) => {
            const doc = byTemplate.get(template)
            const name = t(`store.${template}` as MessageKey)
            const detail = t(`store.${template}.detail` as MessageKey)
            const live = !!doc?.published
            return (
              <ListRow
                key={template}
                testId={`store-page-row-${template}`}
                title={
                  <span className="flex items-center gap-2">
                    <StoreIcon className="size-4 text-muted-foreground" aria-hidden /> {name}
                  </span>
                }
                detail={
                  <>
                    {detail}
                    {' · '}
                    {doc ? `${live ? t('store.live') : t('store.notLive')} ${lastEdited(doc, lang)}` : t('store.standardHint')}
                  </>
                }
                status={doc ? <StatusBadges summary={doc} /> : <Badge variant="soft">{t('store.standard')}</Badge>}
              >
                {doc ? (
                  <>
                    {canManage && <EditLink summary={doc} name={name} />}
                    <ViewLink summary={doc} name={name} />
                    {canPublish && live && (
                      <Button variant="ghost" size="sm" aria-label={t('store.useStandardAria', { name })} data-testid={`use-standard-${template}`} onClick={() => setConfirm({ doc, name })}>
                        <Undo2Icon aria-hidden /> {t('store.useStandard')}
                      </Button>
                    )}
                  </>
                ) : (
                  canManage && (
                    <DesignButtons
                      template={template}
                      name={name}
                      disabled={pending}
                      pending={pendingKey === `template:${template}` ? from : null}
                      onStart={(next) => {
                        setFrom(next)
                        start(templateCreateInput(template, next))
                      }}
                    />
                  )
                )}
              </ListRow>
            )
          })}
        </ul>
        <p className="text-xs text-muted-foreground">{t('store.note')}</p>
      </CardContent>
      <ScreenConfirm
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm ? t('store.useStandardTitle', { name: confirm.name }) : ''}
        description={t('store.useStandardText')}
        confirmLabel={t('store.useStandard')}
        destructive={false}
        pending={unpublish.isPending}
        onConfirm={() => {
          if (!confirm) return
          unpublish.mutate(confirm.doc.id, {
            onSuccess: () => {
              toast.success(t('store.useStandardDone'))
              setConfirm(null)
            },
            onError: (error) => toast.error(error.message),
          })
        }}
      />
    </Card>
  )
}
