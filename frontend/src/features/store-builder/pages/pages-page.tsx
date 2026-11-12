import { useState } from 'react'
import { useNavigate } from 'react-router'
import { FilePlusIcon, HouseIcon, Loader2Icon, PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { ErrorState, LoadingState } from '@/components/common/state-views'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCan } from '@/features/auth/use-auth'
import { StorefrontHeader } from '@/features/storefront/components/storefront-header'
import { ApiError } from '@/lib/api/client'
import { documentPath, useCreateDocumentMutation, useDeleteDocumentMutation, useDocumentsQuery, type DocumentSummary } from '../api'
import { CmsPagesCard, SitePartsCard, ZonesCard, type RemoveRequest } from './builder-parts'
import { ListingColumnsCard } from './listing-columns-card'
import { lastEdited, slugify, slugProblem } from './page-helpers'
import { EditLink, ListRow, StatusBadges, ViewLink } from './page-rows'

/*
 * Online store → Page builder (/admin/storefront/pages), in three groups (B4):
 *  - Pages: the home page, content pages (CMS) designed with the builder, landing pages;
 *  - Site parts: the store's header and footer;
 *  - Shop and product pages: the areas around the product grid / below the product details, and
 *    the products per row of the listings (theme `layout.listing_columns`).
 * Status, creating, editing and deleting (back to the classic rendering) for each.
 */

function PageRow({ summary, canManage, onDelete }: { summary: DocumentSummary; canManage: boolean; onDelete?: () => void }) {
  const path = documentPath(summary)
  return (
    <ListRow
      testId={`page-row-${summary.key}`}
      title={summary.title}
      detail={
        <>
          <span className="font-mono">{path}</span> · {lastEdited(summary)}
        </>
      }
      status={<StatusBadges summary={summary} />}
    >
      {canManage && <EditLink summary={summary} name={summary.title} />}
      <ViewLink summary={summary} name={summary.title} />
      {canManage && onDelete && (
        <Button variant="ghost" size="icon-sm" aria-label={`Delete ${summary.title}`} title="Delete this page" onClick={onDelete}>
          <Trash2Icon />
        </Button>
      )}
    </ListRow>
  )
}

function NewLandingDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const create = useCreateDocumentMutation()
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const effectiveSlug = slugTouched ? slug : slugify(title)
  const titleProblem = title.trim() ? null : 'Enter a title.'
  const slugError = slugProblem(effectiveSlug)
  const serverError = create.error instanceof ApiError ? create.error : null

  const close = (next: boolean) => {
    if (!next) {
      setTitle('')
      setSlug('')
      setSlugTouched(false)
      setSubmitted(false)
      create.reset()
    }
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New landing page</DialogTitle>
          <DialogDescription>A page for a campaign or a collection, at its own address on your store. It starts empty and stays hidden until you publish it.</DialogDescription>
        </DialogHeader>
        <form
          id="new-landing"
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            setSubmitted(true)
            if (titleProblem || slugError) return
            create.mutate(
              { kind: 'page', key: `landing:${effectiveSlug}`, title: title.trim(), from: 'blank' },
              {
                onSuccess: (created) => {
                  toast.success('Landing page created.')
                  close(false)
                  void navigate(`/storefront/builder/${created.id}`)
                },
              },
            )
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="landing-title">Title</Label>
            <Input id="landing-title" value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} aria-invalid={submitted && !!titleProblem} placeholder="Eid collection" />
            {submitted && titleProblem && <p className="text-sm text-destructive">{titleProblem}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="landing-slug">Address</Label>
            <Input
              id="landing-slug"
              value={effectiveSlug}
              maxLength={60}
              onChange={(e) => {
                setSlugTouched(true)
                setSlug(e.target.value.toLowerCase())
              }}
              aria-invalid={submitted && !!slugError}
              aria-describedby="landing-slug-preview"
            />
            <p id="landing-slug-preview" className="text-sm text-muted-foreground">
              Shoppers open it at <span className="font-mono text-foreground">/p/{effectiveSlug || '…'}</span>
            </p>
            {(submitted || slugTouched) && slugError && <p className="text-sm text-destructive">{slugError}</p>}
          </div>
          {serverError && (
            <p role="alert" className="text-sm text-destructive">
              {serverError.code === 'DOCUMENT_EXISTS' ? 'A page with this address already exists. Choose another address.' : serverError.message}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button type="submit" form="new-landing" disabled={create.isPending}>
            {create.isPending && <Loader2Icon className="animate-spin" aria-hidden />}
            Create page
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function HomeCard({ home, canManage }: { home: DocumentSummary | undefined; canManage: boolean }) {
  const create = useCreateDocumentMutation()
  const navigate = useNavigate()
  const start = (from: 'blank' | 'homepage') =>
    create.mutate(
      { kind: 'page', key: 'home', title: 'Home', from },
      {
        onSuccess: (created) => void navigate(`/storefront/builder/${created.id}`),
        onError: (error) => toast.error(error.message),
      },
    )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HouseIcon className="size-5" aria-hidden /> Home page
        </CardTitle>
        <CardDescription>The front page of your store. Until you publish one here, shoppers see the sections on the Homepage tab.</CardDescription>
      </CardHeader>
      <CardContent>
        {home ? (
          <ul className="divide-y">
            <PageRow summary={home} canManage={canManage} />
          </ul>
        ) : canManage ? (
          <div className="flex flex-col gap-3 rounded-md border border-dashed p-4">
            <p className="text-sm">Build your front page with the page builder. Start from an empty page, or copy your current homepage and change it from there — your live store stays as it is until you publish.</p>
            <div className="flex flex-wrap gap-2">
              <Button disabled={create.isPending} onClick={() => start('homepage')}>
                {create.isPending && create.variables?.from === 'homepage' ? <Loader2Icon className="animate-spin" aria-hidden /> : <FilePlusIcon aria-hidden />}
                Copy my current homepage
              </Button>
              <Button variant="outline" disabled={create.isPending} onClick={() => start('blank')}>
                {create.isPending && create.variables?.from === 'blank' ? <Loader2Icon className="animate-spin" aria-hidden /> : <PlusIcon aria-hidden />}
                Start blank
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No home page has been built yet.</p>
        )}
      </CardContent>
    </Card>
  )
}

function GroupHeading({ id, title, description }: { id: string; title: string; description: string }) {
  return (
    <div>
      <h2 id={id} className="text-lg font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  )
}

export function StoreBuilderPagesPage() {
  const can = useCan()
  const canManage = can('storefront.manage')
  const canPublish = can('storefront.publish')
  const canManageContent = can('cms.manage')
  const documents = useDocumentsQuery()
  const remove = useDeleteDocumentMutation()
  const [creating, setCreating] = useState(false)
  const [removing, setRemoving] = useState<RemoveRequest | null>(null)

  const all = documents.data ?? []
  const pages = all.filter((d) => d.kind === 'page')
  const home = pages.find((d) => d.key === 'home')
  const landings = pages.filter((d) => d.key.startsWith('landing:')).sort((a, b) => a.title.localeCompare(b.title))
  const cmsDocs = pages.filter((d) => d.key.startsWith('cms:'))
  const parts = all.filter((d) => d.kind === 'header' || d.kind === 'footer')
  const zones = all.filter((d) => d.kind === 'zone')

  const deleteLanding = (summary: DocumentSummary) =>
    setRemoving({
      summary,
      title: `Delete “${summary.title}”?`,
      description: 'The page, its draft and all its versions are deleted. If it is published, its address stops working.',
      confirmLabel: 'Delete page',
      done: 'Page deleted.',
    })

  return (
    <div className="flex flex-col gap-6">
      <StorefrontHeader />
      {documents.isPending ? (
        <LoadingState rows={3} label="Loading pages" />
      ) : documents.error ? (
        <ErrorState title="Could not load your pages" error={documents.error} onRetry={() => void documents.refetch()} />
      ) : (
        <>
          <section aria-labelledby="group-pages" className="flex flex-col gap-4">
            <GroupHeading id="group-pages" title="Pages" description="Your front page, content pages and landing pages." />
            <HomeCard home={home} canManage={canManage} />
            <CmsPagesCard documents={cmsDocs} canManage={canManage} canManageContent={canManageContent} onRemove={setRemoving} />
            <Card>
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>Landing pages</CardTitle>
                  <CardDescription>Pages for campaigns and collections, each at /p/&lt;address&gt;.</CardDescription>
                </div>
                {canManage && (
                  <Button onClick={() => setCreating(true)}>
                    <PlusIcon aria-hidden /> New landing page
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                {landings.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No landing pages yet.</p>
                ) : (
                  <ul className="divide-y" aria-label="Landing pages">
                    {landings.map((summary) => (
                      <PageRow key={summary.id} summary={summary} canManage={canManage} onDelete={() => deleteLanding(summary)} />
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </section>
          <section aria-labelledby="group-parts" className="flex flex-col gap-4">
            <GroupHeading id="group-parts" title="Site parts" description="The header and footer around every page of your store." />
            <SitePartsCard documents={parts} canManage={canManage} onRemove={setRemoving} />
          </section>
          <section aria-labelledby="group-shop" className="flex flex-col gap-4">
            <GroupHeading id="group-shop" title="Shop and product pages" description="Content around your product listings and product details, and how many products show per row." />
            <ZonesCard documents={zones} canManage={canManage} onRemove={setRemoving}>
              <ListingColumnsCard canManage={canManage} canPublish={canPublish} />
            </ZonesCard>
          </section>
        </>
      )}
      <NewLandingDialog open={creating} onOpenChange={setCreating} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={removing?.title ?? ''}
        description={removing?.description ?? ''}
        confirmLabel={removing?.confirmLabel ?? 'Delete'}
        pending={remove.isPending}
        onConfirm={() => {
          if (!removing) return
          const done = removing.done
          remove.mutate(removing.summary.id, {
            onSuccess: () => {
              toast.success(done)
              setRemoving(null)
            },
            onError: (error) => toast.error(error.message),
          })
        }}
      />
    </div>
  )
}
