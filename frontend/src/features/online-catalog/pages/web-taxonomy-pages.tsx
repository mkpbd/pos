import { useState, type ReactNode } from 'react'
import { Controller, useForm, useWatch, type UseFormReturn } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ExternalLinkIcon, Loader2Icon, PencilIcon } from 'lucide-react'
import { toast } from 'sonner'
import { FormField } from '@/components/common/form-field'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useCan } from '@/features/auth/use-auth'
import { RichTextEditor } from '@/features/content/components/rich-text-editor'
import { MediaField } from '@/features/media/components/media-picker'
import {
  useBrandListingQuery,
  useCategoryListingQuery,
  useSaveBrandListingMutation,
  useSaveCategoryListingMutation,
  useWebBrandsQuery,
  useWebCategoriesQuery,
  type BrandListingResponse,
  type CategoryListingResponse,
  type WebBrandRow,
  type WebCategoryRow,
} from '@/features/online-catalog/api'
import { counter, SEO_DESCRIPTION_MAX, SEO_TITLE_MAX } from '@/features/online-catalog/listing-form'
import {
  BRAND_DESCRIPTION_MAX,
  brandListingSchema,
  TERM_NAME_MAX,
  categoryListingSchema,
  toBrandInput,
  toBrandValues,
  toCategoryInput,
  toCategoryValues,
  webStatus,
  type BrandListingValues,
  type CategoryListingValues,
} from '@/features/online-catalog/taxonomy-form'
import { StorefrontHeader } from '@/features/storefront/components/storefront-header'
import { BanglaTranslations } from '@/features/translations/components/bangla-translations'
import { handleTranslatedFormError, rhfBnErrors } from '@/features/translations/translations'

type Row = { id: string; name: string; is_active: boolean; listing: WebCategoryRow['listing']; depth?: number }

/** Shared fields of both listing forms. */
type CommonValues = { is_visible: boolean; slug: string; seo_title: string; seo_description: string }

function CommonFields<T extends CommonValues>({ form, base, fallbackSlug, children }: { form: UseFormReturn<T>; base: string; fallbackSlug: string; children: ReactNode }) {
  // Narrowed views of the generic form for the shared fields (same names in both schemas).
  const f = form as unknown as UseFormReturn<CommonValues>
  const { errors } = f.formState
  const [slug, seoTitle, seoDescription] = useWatch({ control: f.control, name: ['slug', 'seo_title', 'seo_description'] })

  return (
    <>
      <Controller control={f.control} name="is_visible" render={({ field }) => (
        <div className="flex items-center justify-between gap-3 rounded-md border p-3">
          <div>
            <Label htmlFor="listing-visible">Visible on the store</Label>
            <p className="text-xs text-muted-foreground">Gets its own page and appears in filters and menus.</p>
          </div>
          <Switch id="listing-visible" checked={field.value} onCheckedChange={field.onChange} />
        </div>
      )} />
      <FormField label="Web address" error={errors.slug?.message} hint={<>Shown at <span className="font-mono break-all">{base}/{slug || fallbackSlug || 'your-address'}</span>. Leave empty to use the name.</>}>
        <Input maxLength={120} spellCheck={false} autoCapitalize="none" {...f.register('slug', { setValueAs: (v: string) => v.trim().toLowerCase() })} />
      </FormField>
      {children}
      <FormField label="SEO title" error={errors.seo_title?.message} hint={counter(seoTitle, SEO_TITLE_MAX)}>
        <Input maxLength={SEO_TITLE_MAX} {...f.register('seo_title')} />
      </FormField>
      <FormField label="Meta description" error={errors.seo_description?.message} hint={counter(seoDescription, SEO_DESCRIPTION_MAX)}>
        <Textarea rows={2} maxLength={SEO_DESCRIPTION_MAX} {...f.register('seo_description')} />
      </FormField>
    </>
  )
}

function DialogShell({ title, description, formId, pending, onClose, children }: { title: string; description: string; formId: string; pending: boolean; onClose: () => void; children: ReactNode }) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      {children}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="submit" form={formId} disabled={pending}>
          {pending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
          Save listing
        </Button>
      </DialogFooter>
    </>
  )
}

const CATEGORY_FIELDS = ['is_visible', 'slug', 'image_media_id', 'banner_media_id', 'description_html', 'seo_title', 'seo_description', 'translations'] as const

function CategoryForm({ data, onClose }: { data: CategoryListingResponse; onClose: () => void }) {
  const save = useSaveCategoryListingMutation()
  const form = useForm<CategoryListingValues>({ resolver: zodResolver(categoryListingSchema), defaultValues: toCategoryValues(data) })
  const { errors } = form.formState
  const [descriptionHtml, seoTitle, seoDescription] = useWatch({ control: form.control, name: ['description_html', 'seo_title', 'seo_description'] })

  const submit = form.handleSubmit((values) =>
    save.mutate(
      { id: data.category.id, input: toCategoryInput(values, data.listing.translations) },
      {
        onSuccess: () => {
          toast.success(`${data.category.name} listing saved.`)
          onClose()
        },
        onError: (error) => handleTranslatedFormError(error, form.setError, CATEGORY_FIELDS),
      },
    ),
  )

  return (
    <DialogShell title={`Web listing: ${data.category.name}`} description="The category's page in your online store." formId="category-listing-form" pending={save.isPending} onClose={onClose}>
      <form id="category-listing-form" noValidate onSubmit={submit} className="flex flex-col gap-4">
        <CommonFields form={form} base="/category" fallbackSlug={data.listing.slug}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Image</Label>
              <Controller control={form.control} name="image_media_id" render={({ field }) => <MediaField value={field.value} onChange={field.onChange} title="Category image" />} />
              {errors.image_media_id?.message && <p className="text-sm text-destructive">{errors.image_media_id.message}</p>}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Banner</Label>
              <Controller control={form.control} name="banner_media_id" render={({ field }) => <MediaField value={field.value} onChange={field.onChange} title="Category banner" />} />
              {errors.banner_media_id?.message && <p className="text-sm text-destructive">{errors.banner_media_id.message}</p>}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="category-description">Description</Label>
            <Controller control={form.control} name="description_html" render={({ field }) => (
              <RichTextEditor id="category-description" label="Category description" value={field.value} onChange={field.onChange} invalid={!!errors.description_html} />
            )} />
            {errors.description_html?.message && <p className="text-sm text-destructive">{errors.description_html.message}</p>}
          </div>
        </CommonFields>
        <Controller control={form.control} name="translations.bn" render={({ field }) => (
          <BanglaTranslations
            fields={[
              { name: 'name', label: 'Category name', base: data.category.name, max: TERM_NAME_MAX },
              { name: 'description_html', label: 'Description', base: descriptionHtml, kind: 'rich' },
              { name: 'seo_title', label: 'SEO title', base: seoTitle, max: SEO_TITLE_MAX },
              { name: 'seo_description', label: 'Meta description', base: seoDescription, kind: 'textarea', max: SEO_DESCRIPTION_MAX },
            ]}
            value={field.value}
            onChange={field.onChange}
            errors={rhfBnErrors(errors.translations)}
          />
        )} />
      </form>
    </DialogShell>
  )
}

const BRAND_FIELDS = ['is_visible', 'slug', 'logo_media_id', 'description', 'seo_title', 'seo_description', 'translations'] as const

function BrandForm({ data, onClose }: { data: BrandListingResponse; onClose: () => void }) {
  const save = useSaveBrandListingMutation()
  const form = useForm<BrandListingValues>({ resolver: zodResolver(brandListingSchema), defaultValues: toBrandValues(data) })
  const { errors } = form.formState
  const [description, seoTitle, seoDescription] = useWatch({ control: form.control, name: ['description', 'seo_title', 'seo_description'] })

  const submit = form.handleSubmit((values) =>
    save.mutate(
      { id: data.brand.id, input: toBrandInput(values, data.listing.translations) },
      {
        onSuccess: () => {
          toast.success(`${data.brand.name} listing saved.`)
          onClose()
        },
        onError: (error) => handleTranslatedFormError(error, form.setError, BRAND_FIELDS),
      },
    ),
  )

  return (
    <DialogShell title={`Web listing: ${data.brand.name}`} description="The brand's page in your online store." formId="brand-listing-form" pending={save.isPending} onClose={onClose}>
      <form id="brand-listing-form" noValidate onSubmit={submit} className="flex flex-col gap-4">
        <CommonFields form={form} base="/brand" fallbackSlug={data.listing.slug}>
          <div className="flex flex-col gap-1.5">
            <Label>Logo</Label>
            <Controller control={form.control} name="logo_media_id" render={({ field }) => <MediaField value={field.value} onChange={field.onChange} title="Brand logo" />} />
            {errors.logo_media_id?.message && <p className="text-sm text-destructive">{errors.logo_media_id.message}</p>}
          </div>
          <FormField label="Description" error={errors.description?.message} hint={counter(description, BRAND_DESCRIPTION_MAX)}>
            <Textarea rows={3} maxLength={BRAND_DESCRIPTION_MAX} {...form.register('description')} />
          </FormField>
        </CommonFields>
        <Controller control={form.control} name="translations.bn" render={({ field }) => (
          <BanglaTranslations
            fields={[
              { name: 'name', label: 'Brand name', base: data.brand.name, max: TERM_NAME_MAX },
              { name: 'description', label: 'Description', base: description, kind: 'textarea', rows: 3, max: BRAND_DESCRIPTION_MAX },
              { name: 'seo_title', label: 'SEO title', base: seoTitle, max: SEO_TITLE_MAX },
              { name: 'seo_description', label: 'Meta description', base: seoDescription, kind: 'textarea', max: SEO_DESCRIPTION_MAX },
            ]}
            value={field.value}
            onChange={field.onChange}
            errors={rhfBnErrors(errors.translations)}
          />
        )} />
      </form>
    </DialogShell>
  )
}

function LoadedDialog<T>({ query, children }: { query: { isPending: boolean; error: unknown; data: T | undefined; refetch: () => unknown }; children: (data: T) => ReactNode }) {
  if (query.isPending) return <LoadingState rows={4} label="Loading listing" />
  if (query.error || query.data === undefined) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />
  return <>{children(query.data)}</>
}

function CategoryDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const query = useCategoryListingQuery(id)
  return (
    <Dialog open={id !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        {id !== null && <LoadedDialog query={query}>{(data) => <CategoryForm key={data.category.id} data={data} onClose={onClose} />}</LoadedDialog>}
      </DialogContent>
    </Dialog>
  )
}

function BrandDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const query = useBrandListingQuery(id)
  return (
    <Dialog open={id !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        {id !== null && <LoadedDialog query={query}>{(data) => <BrandForm key={data.brand.id} data={data} onClose={onClose} />}</LoadedDialog>}
      </DialogContent>
    </Dialog>
  )
}

function ListingTable({ rows, base, canManage, onEdit, noun }: { rows: Row[]; base: string; canManage: boolean; onEdit: (row: Row) => void; noun: string }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead className="hidden sm:table-cell">Web address</TableHead>
            <TableHead>On the store</TableHead>
            {canManage && <TableHead className="w-16"><span className="sr-only">Actions</span></TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const status = webStatus(row)
            const path = row.listing ? `${base}/${row.listing.slug}` : null
            return (
              <TableRow key={row.id}>
                <TableCell>
                  <span style={{ paddingLeft: `${(row.depth ?? 0) * 1.25}rem` }} className="font-medium">{(row.depth ?? 0) > 0 && '└ '}{row.name}</span>
                </TableCell>
                <TableCell className="hidden font-mono text-xs text-muted-foreground sm:table-cell">
                  {path && status.label === 'Visible' ? (
                    <a href={path} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline-offset-4 hover:underline">{path} <ExternalLinkIcon className="size-3" aria-hidden /></a>
                  ) : (path ?? '—')}
                </TableCell>
                <TableCell><Badge variant={status.variant}>{status.label}</Badge></TableCell>
                {canManage && (
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon-sm" aria-label={`Edit web listing of ${row.name}`} title={`Edit ${noun} listing`} onClick={() => onEdit(row)}><PencilIcon /></Button>
                  </TableCell>
                )}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

export function WebCategoriesPage() {
  const can = useCan()
  const canManage = can('online_catalog.manage')
  const rows = useWebCategoriesQuery()
  const [editing, setEditing] = useState<string | null>(null)

  return (
    <div className="flex flex-col gap-6">
      <StorefrontHeader />
      <Card>
        <CardHeader>
          <CardTitle>Categories on the web</CardTitle>
          <CardDescription>Every catalog category, with its page in the online store. A page shows the products of the category and its subcategories. Manage the categories themselves under Catalog.</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.isPending ? (
            <LoadingState rows={4} label="Loading categories" />
          ) : rows.error ? (
            <ErrorState error={rows.error} onRetry={() => rows.refetch()} />
          ) : rows.data.length === 0 ? (
            <EmptyState title="No categories yet" description="Create categories under Catalog first." />
          ) : (
            <ListingTable rows={rows.data} base="/category" canManage={canManage} onEdit={(r) => setEditing(r.id)} noun="category" />
          )}
        </CardContent>
      </Card>
      <CategoryDialog id={editing} onClose={() => setEditing(null)} />
    </div>
  )
}

export function WebBrandsPage() {
  const can = useCan()
  const canManage = can('online_catalog.manage')
  const rows = useWebBrandsQuery()
  const [editing, setEditing] = useState<string | null>(null)

  return (
    <div className="flex flex-col gap-6">
      <StorefrontHeader />
      <Card>
        <CardHeader>
          <CardTitle>Brands on the web</CardTitle>
          <CardDescription>Every catalog brand, with its page and filter entry in the online store. Manage the brands themselves under Catalog.</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.isPending ? (
            <LoadingState rows={4} label="Loading brands" />
          ) : rows.error ? (
            <ErrorState error={rows.error} onRetry={() => rows.refetch()} />
          ) : rows.data.length === 0 ? (
            <EmptyState title="No brands yet" description="Create brands under Catalog first." />
          ) : (
            <ListingTable rows={rows.data satisfies WebBrandRow[]} base="/brand" canManage={canManage} onEdit={(r) => setEditing(r.id)} noun="brand" />
          )}
        </CardContent>
      </Card>
      <BrandDialog id={editing} onClose={() => setEditing(null)} />
    </div>
  )
}
