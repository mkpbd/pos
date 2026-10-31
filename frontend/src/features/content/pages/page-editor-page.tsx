import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowLeftIcon, ExternalLinkIcon, Loader2Icon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { FormField } from '@/components/common/form-field'
import { PageHeader } from '@/components/common/page-header'
import { ErrorState, LoadingState } from '@/components/common/state-views'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  PAGE_TEMPLATE_LABELS,
  PAGE_TEMPLATES,
  useDeletePageMutation,
  usePageQuery,
  useSavePageMutation,
  type CmsPage,
  type CmsPageInput,
  type PageStatus,
  type PageTemplate,
} from '@/features/content/api'
import { RichTextEditor } from '@/features/content/components/rich-text-editor'
import { PageStatusBadge } from '@/features/content/components/page-status-badge'
import { slugify, SLUG_PATTERN } from '@/features/content/slug'
import { fromLocalInput, toLocalInput } from '@/features/storefront/schedule'
import { fieldErrorMap } from '@/lib/forms'

type Draft = { title: string; slug: string; template: PageTemplate; status: PageStatus; publishAt: string; body: string; seoTitle: string; seoDescription: string }

const toDraft = (p?: CmsPage): Draft => ({
  title: p?.title ?? '',
  slug: p?.slug ?? '',
  template: p?.template ?? 'default',
  status: p?.status ?? 'draft',
  publishAt: toLocalInput(p?.published_at ?? null),
  body: p?.body_html ?? '',
  seoTitle: p?.seo_title ?? '',
  seoDescription: p?.seo_description ?? '',
})

function Editor({ page }: { page?: CmsPage }) {
  const navigate = useNavigate()
  const save = useSavePageMutation()
  const remove = useDeletePageMutation()
  const [draft, setDraft] = useState<Draft>(() => toDraft(page))
  const [slugTouched, setSlugTouched] = useState(page !== undefined)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [deleting, setDeleting] = useState(false)
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const local: Record<string, string> = {}
    if (!draft.title.trim()) local.title = 'Enter a title.'
    if (!SLUG_PATTERN.test(draft.slug)) local.slug = 'Lower-case letters, digits and single hyphens, e.g. about-us.'
    if (Object.keys(local).length > 0) return setErrors(local)
    setErrors({})

    const input: CmsPageInput = {
      title: draft.title.trim(),
      slug: draft.slug,
      template: draft.template,
      status: draft.status,
      published_at: draft.status === 'published' ? fromLocalInput(draft.publishAt) : null,
      body_html: draft.body || null,
      seo_title: draft.seoTitle.trim() || null,
      seo_description: draft.seoDescription.trim() || null,
    }
    save.mutate(
      { id: page?.id, input },
      {
        onSuccess: (saved) => {
          toast.success(page ? 'Page saved.' : 'Page created.')
          setDraft(toDraft(saved))
          if (!page) void navigate(`/content/pages/${saved.id}`, { replace: true })
        },
        onError: (error) => {
          const map = fieldErrorMap(error)
          setErrors(map)
          if (map.form) toast.error(map.form)
        },
      },
    )
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-6">
      <PageHeader
        title={page ? page.title : 'New page'}
        description={page ? `/pages/${page.slug}` : 'A text page of your online store.'}
        actions={
          <>
            <Button asChild variant="ghost">
              <Link to="/content/pages"><ArrowLeftIcon data-icon="inline-start" /> All pages</Link>
            </Button>
            {page?.is_visible && (
              <Button asChild variant="outline">
                <a href={`/pages/${page.slug}`} target="_blank" rel="noreferrer">
                  <ExternalLinkIcon data-icon="inline-start" /> View in store
                </a>
              </Button>
            )}
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2Icon className="animate-spin" data-icon="inline-start" />} {page ? 'Save page' : 'Create page'}
            </Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardContent className="flex flex-col gap-4">
            <FormField label="Title" error={errors.title}>
              <Input
                maxLength={160}
                value={draft.title}
                onChange={(e) => set(slugTouched ? { title: e.target.value } : { title: e.target.value, slug: slugify(e.target.value) })}
              />
            </FormField>
            <FormField label="Address" error={errors.slug} hint={`Shown at /pages/${draft.slug || 'your-address'}`}>
              <Input
                maxLength={100}
                spellCheck={false}
                value={draft.slug}
                onChange={(e) => {
                  setSlugTouched(true)
                  set({ slug: e.target.value.toLowerCase() })
                }}
              />
            </FormField>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="page-body">Text</Label>
              <RichTextEditor id="page-body" label="Page text" value={draft.body} onChange={(body) => set({ body })} invalid={!!errors.body_html} />
              {errors.body_html && <p className="text-sm text-destructive">{errors.body_html}</p>}
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2">Publishing {page && <PageStatusBadge page={page} />}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <FormField label="Status">
                <Select value={draft.status} onValueChange={(v) => set({ status: v as PageStatus })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft (hidden)</SelectItem>
                    <SelectItem value="published">Published</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
              {draft.status === 'published' && (
                <FormField label="Publish at" error={errors.published_at} hint="Empty: right away. A future time schedules the page.">
                  <Input type="datetime-local" value={draft.publishAt} onChange={(e) => set({ publishAt: e.target.value })} />
                </FormField>
              )}
              <FormField label="Layout">
                <Select value={draft.template} onValueChange={(v) => set({ template: v as PageTemplate })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAGE_TEMPLATES.map((t) => <SelectItem key={t} value={t}>{PAGE_TEMPLATE_LABELS[t]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FormField>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Search engines</CardTitle>
              <CardDescription>Optional. Defaults to the page title and the store description.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <FormField label="SEO title" error={errors.seo_title}>
                <Input maxLength={160} value={draft.seoTitle} onChange={(e) => set({ seoTitle: e.target.value })} />
              </FormField>
              <FormField label="Meta description" error={errors.seo_description} hint={`${draft.seoDescription.length}/300`}>
                <Textarea maxLength={300} rows={3} value={draft.seoDescription} onChange={(e) => set({ seoDescription: e.target.value })} />
              </FormField>
            </CardContent>
          </Card>

          {page && (
            <Button type="button" variant="ghost" className="self-start text-destructive" onClick={() => setDeleting(true)}>
              <Trash2Icon data-icon="inline-start" /> Delete page
            </Button>
          )}
        </div>
      </div>

      {page && (
        <ConfirmDialog
          open={deleting}
          onOpenChange={setDeleting}
          title="Delete this page?"
          description="Visitors will no longer find it. A page that a menu links to cannot be deleted; remove the link first."
          confirmLabel="Delete page"
          pending={remove.isPending}
          onConfirm={() =>
            remove.mutate(page.id, {
              onSuccess: () => {
                toast.success('Page deleted.')
                void navigate('/content/pages')
              },
              onError: (error) => {
                setDeleting(false)
                toast.error(error.message)
              },
            })
          }
        />
      )}
    </form>
  )
}

export function PageEditorPage() {
  const { pageId } = useParams()
  const query = usePageQuery(pageId)

  if (!pageId) return <Editor />
  if (query.isPending) return <LoadingState label="Loading page" />
  if (query.error) return <ErrorState error={query.error} onRetry={() => query.refetch()} />
  return <Editor key={query.data.id} page={query.data} />
}
