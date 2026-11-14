import { useId, useMemo, useState } from 'react'
import { Loader2Icon, PencilIcon, PlusIcon, RulerIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { FormField } from '@/components/common/form-field'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useCan } from '@/features/auth/use-auth'
import { MediaField } from '@/features/media/components/media-picker'
import { useWebCategoriesQuery, type WebCategoryRow } from '@/features/online-catalog/api'
import { SizeGuideTable } from '@/features/storefront/components/size-guide-table'
import { StorefrontHeader } from '@/features/storefront/components/storefront-header'
import {
  draftFromTemplate,
  GUIDE_TEMPLATES,
  SIZE_GUIDE_LIMITS as L,
  sizeGuideErrors,
  toDraft,
  toSizeGuideInput,
  useDeleteSizeGuideMutation,
  useSaveSizeGuideMutation,
  useSizeGuideQuery,
  useSizeGuidesQuery,
  validateDraft,
  type GuideDraft,
  type SizeGuideSummary,
} from '@/features/storefront/size-guides'
import { BanglaTranslations } from '@/features/translations/components/bangla-translations'

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

type Editing = { kind: 'new' } | { kind: 'edit'; id: string } | null

function CategoryPicker({ categories, value, onChange, takenBy, errors, disabled }: {
  categories: WebCategoryRow[]
  value: string[]
  onChange: (ids: string[]) => void
  /** Category id → name of another guide already using it. */
  takenBy: Map<string, string>
  errors: Record<string, string>
  disabled?: boolean
}) {
  const ids = useId()
  const categoryErrors = Object.entries(errors).filter(([k]) => k.startsWith('category_ids'))
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">Show on products of these categories</legend>
      <p className="text-xs text-muted-foreground">Subcategories use the guide of their nearest category. A product can pick another guide on its online store tab.</p>
      {categories.length === 0 ? (
        <p className="text-sm text-muted-foreground">No categories yet — create them under Catalog.</p>
      ) : (
        <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-md border p-2">
          {categories.map((c) => {
            const other = takenBy.get(c.id)
            const checked = value.includes(c.id)
            return (
              <li key={c.id} style={{ paddingLeft: `${c.depth * 1.25}rem` }} className="flex items-center gap-2">
                <Checkbox
                  id={`${ids}-${c.id}`}
                  checked={checked}
                  disabled={disabled || (!!other && !checked)}
                  onCheckedChange={(on) => onChange(on === true ? [...value, c.id] : value.filter((id) => id !== c.id))}
                />
                <Label htmlFor={`${ids}-${c.id}`} className="font-normal">
                  {c.name}
                  {other && !checked && <span className="text-xs text-muted-foreground">(uses “{other}”)</span>}
                </Label>
              </li>
            )
          })}
        </ul>
      )}
      {categoryErrors.map(([key, message]) => <p key={key} className="text-sm text-destructive">{message}</p>)}
    </fieldset>
  )
}

function GuideEditor({ id, initial, guides, onClose }: { id?: string; initial: GuideDraft; guides: SizeGuideSummary[]; onClose: () => void }) {
  const can = useCan()
  const save = useSaveSizeGuideMutation()
  const categories = useWebCategoriesQuery()
  const [draft, setDraft] = useState(initial)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const disabled = !can('online_catalog.manage')
  const takenBy = useMemo(() => {
    const map = new Map<string, string>()
    for (const g of guides) if (g.id !== id) for (const c of g.category_ids) map.set(c, g.name)
    return map
  }, [guides, id])
  const set = <K extends keyof GuideDraft>(key: K, value: GuideDraft[K]) => setDraft((d) => ({ ...d, [key]: value }))
  const bnErrors = Object.fromEntries(Object.entries(errors).filter(([k]) => /^translations\.bn\.(title|intro|note)$/.test(k)).map(([k, v]) => [k.slice('translations.bn.'.length), v]))
  const formErrors = Object.entries(errors).filter(([k]) => k === 'form')

  const submit = () => {
    const client = validateDraft(draft)
    setErrors(client)
    if (Object.keys(client).length) {
      toast.error('Please correct the highlighted fields.')
      return
    }
    save.mutate(
      { id, input: toSizeGuideInput(draft) },
      {
        onSuccess: (saved) => {
          toast.success(`${saved.name} saved.`)
          onClose()
        },
        onError: (error) => {
          const mapped = sizeGuideErrors(error)
          // Name the category in "category_ids.2" messages.
          for (const key of Object.keys(mapped)) {
            const m = /^category_ids\.(\d+)$/.exec(key)
            const category = m ? categories.data?.find((c) => c.id === draft.category_ids[Number(m[1])]) : undefined
            if (category) mapped[key] = `${category.name}: ${mapped[key]}`
          }
          setErrors(mapped)
          if (!mapped.form) toast.error('Please correct the highlighted fields.')
        },
      },
    )
  }

  return (
    <form
      noValidate
      aria-label="Size guide"
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault()
        if (!save.isPending) submit()
      }}
    >
      <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Name (for you)" error={errors.name} hint="e.g. “Kids clothes” — not shown to shoppers.">
            <Input maxLength={L.name} value={draft.name} onChange={(e) => set('name', e.target.value)} autoFocus={!id} />
          </FormField>
          <FormField label="Title" error={errors.title} hint="Shown at the top of the size guide.">
            <Input maxLength={L.title} value={draft.title} onChange={(e) => set('title', e.target.value)} />
          </FormField>
          <FormField label="Introduction" error={errors.intro} hint="Optional, e.g. how to measure." className="sm:col-span-2">
            <Textarea rows={2} maxLength={L.text} value={draft.intro} onChange={(e) => set('intro', e.target.value)} />
          </FormField>
        </div>
        <section className="flex flex-col gap-2" aria-label="Measurements">
          <h3 className="text-sm font-semibold">Measurements</h3>
          <SizeGuideTable draft={draft} onChange={setDraft} mode="en" errors={errors} disabled={disabled} />
        </section>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
          <FormField label="Note" error={errors.note} hint="Optional, shown under the table, e.g. “Measurements may vary by 1 cm.”">
            <Textarea rows={2} maxLength={L.text} value={draft.note} onChange={(e) => set('note', e.target.value)} />
          </FormField>
          <div className="flex flex-col gap-1.5">
            <Label>Picture (optional)</Label>
            <MediaField value={draft.image_media_id} onChange={(v) => set('image_media_id', v)} title="Size guide picture" disabled={disabled} />
            {errors.image_media_id && <p className="text-sm text-destructive">{errors.image_media_id}</p>}
          </div>
        </div>
        {categories.isPending ? (
          <LoadingState rows={2} label="Loading categories" />
        ) : categories.error ? (
          <ErrorState error={categories.error} onRetry={() => categories.refetch()} />
        ) : (
          <CategoryPicker categories={categories.data} value={draft.category_ids} onChange={(v) => set('category_ids', v)} takenBy={takenBy} errors={errors} disabled={disabled} />
        )}
        <BanglaTranslations
          fields={[
            { name: 'title', label: 'Title', base: draft.title, max: L.title },
            { name: 'intro', label: 'Introduction', base: draft.intro, kind: 'textarea', max: L.text },
            { name: 'note', label: 'Note', base: draft.note, kind: 'textarea', max: L.text },
          ]}
          value={{ title: draft.bn.title, intro: draft.bn.intro, note: draft.bn.note }}
          onChange={(v) => setDraft((d) => ({ ...d, bn: { ...d.bn, title: v.title ?? '', intro: v.intro ?? '', note: v.note ?? '' } }))}
          errors={bnErrors}
          disabled={disabled}
        />
        <details className="rounded-md border" open={Object.keys(errors).some((k) => k.startsWith('translations.bn.columns') || k.startsWith('translations.bn.cells')) || undefined}>
          <summary className="cursor-pointer p-3 text-sm font-semibold">
            Table in <span lang="bn">বাংলা</span> (Bangla)
          </summary>
          <div className="flex flex-col gap-2 border-t p-3">
            <p className="text-sm text-muted-foreground">Leave a cell empty to show the English text. Numbers usually stay the same.</p>
            <SizeGuideTable draft={draft} onChange={setDraft} mode="bn" errors={errors} disabled={disabled} />
          </div>
        </details>
      </fieldset>
      {formErrors.map(([key, message]) => <p key={key} role="alert" className="text-sm text-destructive">{message}</p>)}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>{disabled ? 'Close' : 'Cancel'}</Button>
        {!disabled && (
          <Button type="submit" disabled={save.isPending}>
            {save.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            Save size guide
          </Button>
        )}
      </DialogFooter>
    </form>
  )
}

function EditGuide({ id, guides, onClose }: { id: string; guides: SizeGuideSummary[]; onClose: () => void }) {
  const query = useSizeGuideQuery(id)
  if (query.isPending) return <LoadingState rows={4} label="Loading size guide" />
  if (query.error) return <ErrorState error={query.error} onRetry={() => query.refetch()} />
  return <GuideEditor key={query.data.id} id={id} initial={toDraft(query.data)} guides={guides} onClose={onClose} />
}

function NewGuide({ guides, onClose }: { guides: SizeGuideSummary[]; onClose: () => void }) {
  const [draft, setDraft] = useState<GuideDraft | null>(null)
  if (draft) return <GuideEditor initial={draft} guides={guides} onClose={onClose} />
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">Start from a ready table — you can rename, add or remove rows and columns afterwards.</p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {GUIDE_TEMPLATES.map((t) => (
          <li key={t.key}>
            <button
              type="button"
              onClick={() => setDraft(draftFromTemplate(t))}
              className="flex w-full flex-col items-start gap-1 rounded-md border p-3 text-left outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span className="font-medium">{t.label}</span>
              <span className="text-xs text-muted-foreground">{t.columns.join(' · ')}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Online store → Size guides (P1a §4). */
export function SizeGuidesPage() {
  const can = useCan()
  const canManage = can('online_catalog.manage')
  const guides = useSizeGuidesQuery()
  const categories = useWebCategoriesQuery()
  const remove = useDeleteSizeGuideMutation()
  const [editing, setEditing] = useState<Editing>(null)
  const [deleting, setDeleting] = useState<SizeGuideSummary | null>(null)
  const categoryName = useMemo(() => new Map((categories.data ?? []).map((c) => [c.id, c.name])), [categories.data])
  const list = guides.data ?? []

  return (
    <div className="flex flex-col gap-6">
      <StorefrontHeader />
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <CardTitle>Size guides</CardTitle>
            <CardDescription>
              Measurement tables shoppers open from the product page (“Size guide” next to the size choice). Assign a guide to categories; a
              product can choose a different one on its online store tab.
            </CardDescription>
          </div>
          {canManage && (
            <Button onClick={() => setEditing({ kind: 'new' })}>
              <PlusIcon data-icon="inline-start" /> New size guide
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {guides.isPending ? (
            <LoadingState rows={3} label="Loading size guides" />
          ) : guides.error ? (
            <ErrorState error={guides.error} onRetry={() => guides.refetch()} />
          ) : list.length === 0 ? (
            <EmptyState
              title="No size guides yet"
              description="Add one so shoppers can check their size before buying clothes or shoes."
              action={canManage ? <Button onClick={() => setEditing({ kind: 'new' })}><RulerIcon data-icon="inline-start" /> Create a size guide</Button> : undefined}
            />
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="hidden sm:table-cell">Title</TableHead>
                    <TableHead>Categories</TableHead>
                    <TableHead className="hidden text-right md:table-cell">Products</TableHead>
                    <TableHead className="hidden md:table-cell">Updated</TableHead>
                    <TableHead className="w-20"><span className="sr-only">Actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((g) => (
                    <TableRow key={g.id}>
                      <TableCell className="font-medium">{g.name}</TableCell>
                      <TableCell className="hidden sm:table-cell">{g.title}</TableCell>
                      <TableCell>
                        {g.category_ids.length === 0 ? (
                          <span className="text-sm text-muted-foreground">None</span>
                        ) : (
                          <span className="flex flex-wrap gap-1">{g.category_ids.map((id) => <Badge key={id} variant="outline">{categoryName.get(id) ?? '…'}</Badge>)}</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums md:table-cell">{g.products_count}</TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{dateFormat.format(new Date(g.updated_at))}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <Button variant="ghost" size="icon-sm" aria-label={`${canManage ? 'Edit' : 'View'} size guide ${g.name}`} onClick={() => setEditing({ kind: 'edit', id: g.id })}><PencilIcon /></Button>
                        {canManage && <Button variant="ghost" size="icon-sm" aria-label={`Delete size guide ${g.name}`} onClick={() => setDeleting(g)}><Trash2Icon /></Button>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{editing?.kind === 'new' ? 'New size guide' : 'Size guide'}</DialogTitle>
            <DialogDescription>Shoppers see the title, introduction, table, note and picture — in Bangla when they switch the store language.</DialogDescription>
          </DialogHeader>
          {editing?.kind === 'new' && <NewGuide guides={list} onClose={() => setEditing(null)} />}
          {editing?.kind === 'edit' && <EditGuide id={editing.id} guides={list} onClose={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.name ?? 'size guide'}?`}
        description="Products using it fall back to their category’s size guide, or show none."
        confirmLabel="Delete"
        pending={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => {
              toast.success(`${deleting.name} deleted.`)
              setDeleting(null)
            },
            onError: (e) => toast.error(e.message),
          })
        }
      />
    </div>
  )
}
