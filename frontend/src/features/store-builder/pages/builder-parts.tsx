import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { FileTextIcon, Loader2Icon, PaintbrushIcon, PanelBottomIcon, PanelTopIcon, PlusIcon, Trash2Icon, Undo2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ErrorState, LoadingState } from '@/components/common/state-views'
import { ApiError } from '@/lib/api/client'
import { builderAdminKeys, useCmsPagesQuery, useCreateDocumentMutation, type BuilderCmsPage, type CreateDocumentInput, type DocumentSummary, type ZoneDocumentKey } from '../api'
import { ZONE_DOCUMENT_KEYS, ZONE_TITLES } from '../document-kind'
import type { MessageKey } from './messages'
import { lastEdited } from './page-helpers'
import { EditLink, ListRow, StatusBadges, ViewLink } from './page-rows'
import { useScreenText } from './screen-language'

/*
 * B4 groups of the pages list: CMS pages designed with the builder, the store's header and
 * footer, and the content areas of the shop and product pages. Deleting any of these documents
 * brings back the classic rendering (the CMS text, the theme's header / footer, nothing).
 * B7: plain words in the screen's language; the group headings name the cards.
 */

/** What the delete confirmation says for a document. */
export type RemoveRequest = { summary: DocumentSummary; title: string; description: string; confirmLabel: string; done: string }

/** Creates a document and opens the editor; a document that already exists refreshes the list. */
function useStartDocument() {
  const { t } = useScreenText()
  const create = useCreateDocumentMutation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const start = (input: CreateDocumentInput) =>
    create.mutate(input, {
      onSuccess: (created) => void navigate(`/storefront/builder/${created.id}`),
      onError: (error) => {
        if (error instanceof ApiError && error.code === 'DOCUMENT_EXISTS') {
          toast.info(t('start.elsewhere'))
          void queryClient.invalidateQueries({ queryKey: builderAdminKeys.documents })
        } else toast.error(error.message)
      },
    })
  const pendingKey = create.isPending ? create.variables?.key : undefined
  return { start, pendingKey, pending: create.isPending }
}

const TEMPLATE_HINT: Record<string, MessageKey> = { faq: 'cms.hint.faq', contact: 'cms.hint.contact' }

/* ---------------------------------------------------------------------------------------------- */

export function CmsPagesCard({ documents, canManage, canManageContent, onRemove }: { documents: DocumentSummary[]; canManage: boolean; canManageContent: boolean; onRemove: (request: RemoveRequest) => void }) {
  const { t, lang } = useScreenText()
  const pages = useCmsPagesQuery(canManageContent)
  const { start, pendingKey, pending } = useStartDocument()
  const byKey = new Map(documents.map((d) => [d.key, d]))
  // Pages from the Cms module, plus designs whose page the list doesn't show (more than 100 pages).
  const rows: { page: BuilderCmsPage | null; doc: DocumentSummary | undefined; id: string }[] = (pages.data ?? []).map((page) => ({ page, doc: byKey.get(`cms:${page.id}`), id: page.id }))
  const listed = new Set(rows.map((r) => r.id))
  for (const doc of documents) {
    const id = doc.key.slice('cms:'.length)
    if (!listed.has(id)) rows.push({ page: doc.cms_page ? { ...doc.cms_page, template: doc.cms_page.template ?? null } : null, doc, id })
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <FileTextIcon className="size-5" aria-hidden /> {t('cms.title')}
          </CardTitle>
          <CardDescription>{t('cms.text')}</CardDescription>
        </div>
        {canManageContent && (
          <Button variant="outline" size="sm" asChild>
            <Link to="/content/pages">{t('cms.manage')}</Link>
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {pages.isPending ? (
          <LoadingState rows={2} label={t('cms.loading')} />
        ) : pages.error ? (
          <ErrorState title={t('cms.error')} error={pages.error} onRetry={() => void pages.refetch()} />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('cms.empty')}
            {canManageContent ? ` ${t('cms.emptyCreate')}` : ''}
          </p>
        ) : (
          <ul className="divide-y" aria-label={t('cms.listLabel')}>
            {rows.map(({ page, doc, id }) => {
              const title = page?.title ?? doc?.title ?? t('cms.page')
              const hint = page?.template ? TEMPLATE_HINT[page.template] : undefined
              const key = `cms:${id}`
              return (
                <ListRow
                  key={id}
                  testId={`page-row-${key}`}
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      {title}
                      {page?.status === 'draft' && <Badge variant="soft">{t('cms.notPublished')}</Badge>}
                    </span>
                  }
                  detail={
                    <>
                      <span className="font-mono">{page ? `/pages/${page.slug}` : '—'}</span>
                      {hint && ` · ${t(hint)}`}
                      {doc ? ` · ${t('cms.designed')} · ${lastEdited(doc, lang)}` : ` · ${t('cms.classic')}`}
                    </>
                  }
                  status={doc ? <StatusBadges summary={doc} /> : undefined}
                >
                  {doc ? (
                    <>
                      {canManage && <EditLink summary={doc} label={t('cms.editDesign')} name={title} />}
                      <ViewLink summary={doc} name={title} />
                      {canManage && (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t('cms.backAria', { name: title })}
                          title={t('cms.backHint')}
                          onClick={() =>
                            onRemove({
                              summary: doc,
                              title: t('cms.backTitle', { name: title }),
                              description: t('cms.backText'),
                              confirmLabel: t('cms.backConfirm'),
                              done: t('cms.backDone'),
                            })
                          }
                        >
                          <Undo2Icon aria-hidden /> {t('cms.back')}
                        </Button>
                      )}
                    </>
                  ) : (
                    canManage &&
                    page && (
                      <Button size="sm" variant="outline" disabled={pending} aria-label={t('cms.designAria', { name: title })} onClick={() => start({ kind: 'page', key, title, from: 'cms' })}>
                        {pendingKey === key ? <Loader2Icon className="animate-spin" aria-hidden /> : <PaintbrushIcon aria-hidden />}
                        {t('cms.design')}
                      </Button>
                    )
                  )}
                </ListRow>
              )
            })}
          </ul>
        )}
        {canManage && rows.some((r) => !r.doc) && <p className="mt-3 text-xs text-muted-foreground">{t('cms.note')}</p>}
      </CardContent>
    </Card>
  )
}

/* ---------------------------------------------------------------------------------------------- */

const PARTS = [
  { kind: 'header' as const, title: 'Header', icon: PanelTopIcon },
  { kind: 'footer' as const, title: 'Footer', icon: PanelBottomIcon },
]

export function SitePartsCard({ documents, canManage, onRemove }: { documents: DocumentSummary[]; canManage: boolean; onRemove: (request: RemoveRequest) => void }) {
  const { t, lang } = useScreenText()
  const { start, pendingKey, pending } = useStartDocument()
  return (
    <Card>
      <CardContent>
        <ul className="divide-y" aria-label={t('parts.listLabel')}>
          {PARTS.map((part) => {
            const doc = documents.find((d) => d.kind === part.kind)
            const Icon = part.icon
            const k = `parts.${part.kind}` as const
            const pk = (suffix: string) => `${k}${suffix}` as MessageKey
            const remove = t(pk('.remove'))
            const detail = t(pk('.detail'))
            return (
              <ListRow
                key={part.kind}
                testId={`page-row-${part.kind}`}
                title={
                  <span className="flex items-center gap-2">
                    <Icon className="size-4 text-muted-foreground" aria-hidden /> {t(k)}
                  </span>
                }
                detail={doc ? `${detail} ${lastEdited(doc, lang)}` : `${detail} ${t(pk('.classic'))}`}
                status={doc ? <StatusBadges summary={doc} /> : undefined}
              >
                {doc ? (
                  <>
                    {canManage && <EditLink summary={doc} name={t(pk('.editName'))} />}
                    {canManage && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          onRemove({
                            summary: doc,
                            title: t('parts.removeTitle', { label: remove }),
                            description: t(pk('.removeText')),
                            confirmLabel: remove,
                            done: t(pk('.removed')),
                          })
                        }
                      >
                        <Undo2Icon aria-hidden /> {remove}
                      </Button>
                    )}
                  </>
                ) : (
                  canManage && (
                    <Button size="sm" variant="outline" disabled={pending} aria-label={t(pk('.design'))} title={t('parts.designHint')} onClick={() => start({ kind: part.kind, key: part.kind, title: part.title, from: 'current' })}>
                      {pendingKey === part.kind ? <Loader2Icon className="animate-spin" aria-hidden /> : <PaintbrushIcon aria-hidden />}
                      {t('parts.design')}
                    </Button>
                  )
                )}
              </ListRow>
            )
          })}
        </ul>
        {canManage && <p className="mt-3 text-xs text-muted-foreground">{t('parts.note')}</p>}
      </CardContent>
    </Card>
  )
}

/* ---------------------------------------------------------------------------------------------- */

export function ZonesCard({ documents, canManage, onRemove, children }: { documents: DocumentSummary[]; canManage: boolean; onRemove: (request: RemoveRequest) => void; children?: ReactNode }) {
  const { t, lang } = useScreenText()
  const { start, pendingKey, pending } = useStartDocument()
  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{t('zones.text')}</p>
        <ul className="divide-y" aria-label={t('zones.listLabel')}>
          {ZONE_DOCUMENT_KEYS.map((key: ZoneDocumentKey) => {
            const doc = documents.find((d) => d.key === key)
            const title = t(`zone.${key}` as MessageKey)
            const placement = t(`zone.${key}.detail` as MessageKey)
            return (
              <ListRow key={key} testId={`page-row-${key}`} title={title} detail={doc ? `${placement} ${lastEdited(doc, lang)}` : placement} status={doc ? <StatusBadges summary={doc} /> : undefined}>
                {doc ? (
                  <>
                    {canManage && <EditLink summary={doc} name={title} />}
                    {canManage && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('zones.removeAria', { name: title })}
                        title={t('zones.removeHint')}
                        onClick={() =>
                          onRemove({
                            summary: doc,
                            title: t('zones.removeTitle', { name: title }),
                            description: t('zones.removeText'),
                            confirmLabel: t('zones.removeConfirm'),
                            done: t('zones.removed'),
                          })
                        }
                      >
                        <Trash2Icon />
                      </Button>
                    )}
                  </>
                ) : (
                  canManage && (
                    // The document keeps the editor's (English) name of the area.
                    <Button size="sm" variant="outline" disabled={pending} aria-label={t('zones.addAria', { name: title })} onClick={() => start({ kind: 'zone', key, title: ZONE_TITLES[key], from: 'blank' })}>
                      {pendingKey === key ? <Loader2Icon className="animate-spin" aria-hidden /> : <PlusIcon aria-hidden />}
                      {t('zones.add')}
                    </Button>
                  )
                )}
              </ListRow>
            )
          })}
        </ul>
        {children}
      </CardContent>
    </Card>
  )
}
