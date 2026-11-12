import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { FileTextIcon, LayoutPanelTopIcon, Loader2Icon, PaintbrushIcon, PanelBottomIcon, PanelTopIcon, PlusIcon, ShoppingBagIcon, Trash2Icon, Undo2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ErrorState, LoadingState } from '@/components/common/state-views'
import { ApiError } from '@/lib/api/client'
import { builderAdminKeys, useCmsPagesQuery, useCreateDocumentMutation, type BuilderCmsPage, type CreateDocumentInput, type DocumentSummary, type ZoneDocumentKey } from '../api'
import { ZONE_DOCUMENT_KEYS, ZONE_PLACEMENT, ZONE_TITLES } from '../document-kind'
import { lastEdited } from './page-helpers'
import { EditLink, ListRow, StatusBadges, ViewLink } from './page-rows'

/*
 * B4 groups of the pages list: CMS pages designed with the builder, the store's header and
 * footer, and the content areas of the shop and product pages. Deleting any of these documents
 * brings back the classic rendering (the CMS text, the theme's header / footer, nothing).
 */

/** What the delete confirmation says for a document. */
export type RemoveRequest = { summary: DocumentSummary; title: string; description: string; confirmLabel: string; done: string }

/** Creates a document and opens the editor; a document that already exists refreshes the list. */
function useStartDocument() {
  const create = useCreateDocumentMutation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const start = (input: CreateDocumentInput) =>
    create.mutate(input, {
      onSuccess: (created) => void navigate(`/storefront/builder/${created.id}`),
      onError: (error) => {
        if (error instanceof ApiError && error.code === 'DOCUMENT_EXISTS') {
          toast.info('It was just created somewhere else. Open it from the list.')
          void queryClient.invalidateQueries({ queryKey: builderAdminKeys.documents })
        } else toast.error(error.message)
      },
    })
  const pendingKey = create.isPending ? create.variables?.key : undefined
  return { start, pendingKey, pending: create.isPending }
}

const TEMPLATE_HINT: Record<string, string> = { faq: 'FAQ page', contact: 'Contact page' }

/* ---------------------------------------------------------------------------------------------- */

export function CmsPagesCard({ documents, canManage, canManageContent, onRemove }: { documents: DocumentSummary[]; canManage: boolean; canManageContent: boolean; onRemove: (request: RemoveRequest) => void }) {
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
            <FileTextIcon className="size-5" aria-hidden /> Content pages
          </CardTitle>
          <CardDescription>About, Contact, FAQ, Privacy, Terms and your other pages. Design one with the builder, or keep the classic page with its text. Titles, addresses and search texts stay on the Content pages screen.</CardDescription>
        </div>
        {canManageContent && (
          <Button variant="outline" size="sm" asChild>
            <Link to="/content/pages">Manage pages</Link>
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {pages.isPending ? (
          <LoadingState rows={2} label="Loading content pages" />
        ) : pages.error ? (
          <ErrorState title="Could not load your content pages" error={pages.error} onRetry={() => void pages.refetch()} />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No content pages yet.{canManageContent ? ' Create them under Content → Pages.' : ''}</p>
        ) : (
          <ul className="divide-y" aria-label="Content pages">
            {rows.map(({ page, doc, id }) => {
              const title = page?.title ?? doc?.title ?? 'Page'
              const hint = page?.template ? TEMPLATE_HINT[page.template] : undefined
              const key = `cms:${id}`
              return (
                <ListRow
                  key={id}
                  testId={`page-row-${key}`}
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      {title}
                      {page?.status === 'draft' && <Badge variant="soft">Page not published</Badge>}
                    </span>
                  }
                  detail={
                    <>
                      <span className="font-mono">{page ? `/pages/${page.slug}` : '—'}</span>
                      {hint && ` · ${hint}`}
                      {doc ? ` · Designed with the builder · ${lastEdited(doc)}` : ' · Classic page'}
                    </>
                  }
                  status={doc ? <StatusBadges summary={doc} /> : undefined}
                >
                  {doc ? (
                    <>
                      {canManage && <EditLink summary={doc} label="Edit design" name={title} />}
                      <ViewLink summary={doc} name={title} />
                      {canManage && (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Back to the classic page for ${title}`}
                          title="Delete the design: the page shows its text again"
                          onClick={() =>
                            onRemove({
                              summary: doc,
                              title: `Go back to the classic “${title}” page?`,
                              description: 'The design, its draft and all its versions are deleted. The page shows its text from Content → Pages again (FAQ and contact form included). Its title and address stay as they are.',
                              confirmLabel: 'Use the classic page',
                              done: 'The page is back to its classic look.',
                            })
                          }
                        >
                          <Undo2Icon aria-hidden /> Back to the classic page
                        </Button>
                      )}
                    </>
                  ) : (
                    canManage &&
                    page && (
                      <Button size="sm" variant="outline" disabled={pending} aria-label={`Design ${title} with the builder`} onClick={() => start({ kind: 'page', key, title, from: 'cms' })}>
                        {pendingKey === key ? <Loader2Icon className="animate-spin" aria-hidden /> : <PaintbrushIcon aria-hidden />}
                        Design with the builder
                      </Button>
                    )
                  )}
                </ListRow>
              )
            })}
          </ul>
        )}
        {canManage && rows.some((r) => !r.doc) && (
          <p className="mt-3 text-xs text-muted-foreground">Designing a page copies its text into the builder. The classic page stays live until you publish the design.</p>
        )}
      </CardContent>
    </Card>
  )
}

/* ---------------------------------------------------------------------------------------------- */

const PARTS = [
  {
    kind: 'header' as const,
    title: 'Header',
    icon: PanelTopIcon,
    detail: 'The top of every page: logo, menu, search, account and cart. Phones keep the compact header.',
    classic: 'Using the theme’s header.',
    remove: 'Use the theme’s header',
  },
  {
    kind: 'footer' as const,
    title: 'Footer',
    icon: PanelBottomIcon,
    detail: 'The bottom of every page: about text, menus, contact details, social and payment icons.',
    classic: 'Using the theme’s footer.',
    remove: 'Use the theme’s footer',
  },
]

export function SitePartsCard({ documents, canManage, onRemove }: { documents: DocumentSummary[]; canManage: boolean; onRemove: (request: RemoveRequest) => void }) {
  const { start, pendingKey, pending } = useStartDocument()
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LayoutPanelTopIcon className="size-5" aria-hidden /> Site parts
        </CardTitle>
        <CardDescription>Design the header and footer shown on every page. Until you publish one, your store uses the theme’s.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y" aria-label="Site parts">
          {PARTS.map((part) => {
            const doc = documents.find((d) => d.kind === part.kind)
            const Icon = part.icon
            return (
              <ListRow
                key={part.kind}
                testId={`page-row-${part.kind}`}
                title={
                  <span className="flex items-center gap-2">
                    <Icon className="size-4 text-muted-foreground" aria-hidden /> {part.title}
                  </span>
                }
                detail={doc ? `${part.detail} ${lastEdited(doc)}` : `${part.detail} ${part.classic}`}
                status={doc ? <StatusBadges summary={doc} /> : undefined}
              >
                {doc ? (
                  <>
                    {canManage && <EditLink summary={doc} name={`the ${part.kind}`} />}
                    {canManage && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          onRemove({
                            summary: doc,
                            title: `${part.remove}?`,
                            description: `Your designed ${part.kind}, its draft and all its versions are deleted. The store shows the theme’s ${part.kind} again (set on the Theme page).`,
                            confirmLabel: part.remove,
                            done: `The store uses the theme’s ${part.kind} again.`,
                          })
                        }
                      >
                        <Undo2Icon aria-hidden /> {part.remove}
                      </Button>
                    )}
                  </>
                ) : (
                  canManage && (
                    <Button size="sm" variant="outline" disabled={pending} aria-label={`Design the ${part.kind}`} title={`Starts from your current ${part.kind}`} onClick={() => start({ kind: part.kind, key: part.kind, title: part.title, from: 'current' })}>
                      {pendingKey === part.kind ? <Loader2Icon className="animate-spin" aria-hidden /> : <PaintbrushIcon aria-hidden />}
                      Design
                    </Button>
                  )
                )}
              </ListRow>
            )
          })}
        </ul>
        {canManage && <p className="mt-3 text-xs text-muted-foreground">Designing starts from the header or footer your store shows now; the live store doesn’t change until you publish.</p>}
      </CardContent>
    </Card>
  )
}

/* ---------------------------------------------------------------------------------------------- */

export function ZonesCard({ documents, canManage, onRemove, children }: { documents: DocumentSummary[]; canManage: boolean; onRemove: (request: RemoveRequest) => void; children?: ReactNode }) {
  const { start, pendingKey, pending } = useStartDocument()
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShoppingBagIcon className="size-5" aria-hidden /> Shop and product pages
        </CardTitle>
        <CardDescription>Add your own content around the product grid of the shop, category, brand and search pages, and below the details of every product. The products, filters, cart and checkout always work as they do now.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <ul className="divide-y" aria-label="Shop and product page areas">
          {ZONE_DOCUMENT_KEYS.map((key: ZoneDocumentKey) => {
            const doc = documents.find((d) => d.key === key)
            const title = ZONE_TITLES[key]
            return (
              <ListRow key={key} testId={`page-row-${key}`} title={title} detail={doc ? `${ZONE_PLACEMENT[key]} ${lastEdited(doc)}` : ZONE_PLACEMENT[key]} status={doc ? <StatusBadges summary={doc} /> : undefined}>
                {doc ? (
                  <>
                    {canManage && <EditLink summary={doc} name={title} />}
                    {canManage && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${title}`}
                        title="Remove this area"
                        onClick={() =>
                          onRemove({
                            summary: doc,
                            title: `Remove the “${title}” area?`,
                            description: 'The area, its draft and all its versions are deleted. The pages show without it, exactly as before.',
                            confirmLabel: 'Remove area',
                            done: 'Area removed.',
                          })
                        }
                      >
                        <Trash2Icon />
                      </Button>
                    )}
                  </>
                ) : (
                  canManage && (
                    <Button size="sm" variant="outline" disabled={pending} aria-label={`Create ${title}`} onClick={() => start({ kind: 'zone', key, title, from: 'blank' })}>
                      {pendingKey === key ? <Loader2Icon className="animate-spin" aria-hidden /> : <PlusIcon aria-hidden />}
                      Create
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
