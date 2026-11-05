import { useState } from 'react'
import { ArrowDownIcon, ArrowUpIcon, Loader2Icon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { FormField } from '@/components/common/form-field'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  useBlogCategoriesQuery,
  useDeleteBlogCategoryMutation,
  useReorderBlogCategoriesMutation,
  useSaveBlogCategoryMutation,
  type BlogCategory,
} from '@/features/content/api'
import { BLOG_CATEGORY_TRANSLATION_NAMES, BLOG_CATEGORY_TRANSLATIONS, BLOG_LIMITS, blogDeleteError } from '@/features/content/blog'
import { slugify, SLUG_PATTERN } from '@/features/content/slug'
import { BanglaTranslations } from '@/features/translations/components/bangla-translations'
import { bnErrors, readBn, toTranslationsInput, validateBn, type BnValues } from '@/features/translations/translations'
import { fieldErrorMap } from '@/lib/forms'

/** Add or edit one category; the address follows the name until it is edited by hand. */
function CategoryForm({ category, onDone }: { category: BlogCategory | null; onDone: () => void }) {
  const save = useSaveBlogCategoryMutation()
  const [name, setName] = useState(category?.name ?? '')
  const [slug, setSlug] = useState(category?.slug ?? '')
  const [slugTouched, setSlugTouched] = useState(category !== null)
  const [description, setDescription] = useState(category?.description ?? '')
  const [bn, setBn] = useState<BnValues>(() => readBn(category?.translations, BLOG_CATEGORY_TRANSLATION_NAMES))
  const [errors, setErrors] = useState<Record<string, string>>({})

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const local: Record<string, string> = {}
    if (!name.trim()) local.name = 'Enter a name.'
    if (!SLUG_PATTERN.test(slug)) local.slug = 'Lower-case letters, digits and single hyphens, e.g. store-news.'
    Object.assign(local, validateBn(bn, BLOG_CATEGORY_TRANSLATIONS))
    if (Object.keys(local).length > 0) return setErrors(local)
    setErrors({})

    save.mutate(
      { id: category?.id, input: { name: name.trim(), slug, description: description.trim() || null, translations: toTranslationsInput(bn, BLOG_CATEGORY_TRANSLATION_NAMES, category?.translations) } },
      {
        onSuccess: () => {
          toast.success(category ? 'Category saved.' : 'Category added.')
          onDone()
        },
        onError: (error) => setErrors(fieldErrorMap(error)),
      },
    )
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-3 rounded-md border bg-muted/40 p-3" aria-label={category ? `Edit ${category.name}` : 'New category'}>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Category name" error={errors.name}>
          <Input
            autoFocus
            maxLength={BLOG_LIMITS.categoryName}
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              if (!slugTouched) setSlug(slugify(e.target.value))
            }}
          />
        </FormField>
        <FormField label="Category address" error={errors.slug} hint={`/blog/category/${slug || 'address'}`}>
          <Input
            maxLength={BLOG_LIMITS.slug}
            spellCheck={false}
            value={slug}
            onChange={(e) => {
              setSlugTouched(true)
              setSlug(e.target.value.toLowerCase())
            }}
          />
        </FormField>
      </div>
      <FormField label="Description (optional)" error={errors.description} hint={`${description.length}/${BLOG_LIMITS.categoryDescription}`}>
        <Textarea rows={2} maxLength={BLOG_LIMITS.categoryDescription} value={description} onChange={(e) => setDescription(e.target.value)} />
      </FormField>
      <BanglaTranslations
        className="bg-background"
        fields={[
          { name: 'name', label: 'Category name', base: name, max: BLOG_LIMITS.categoryName },
          { name: 'description', label: 'Description', base: description, kind: 'textarea', max: BLOG_LIMITS.categoryDescription },
        ]}
        value={bn}
        onChange={setBn}
        errors={bnErrors(errors)}
      />
      {errors.form && <p role="alert" className="text-sm text-destructive">{errors.form}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onDone}>Cancel</Button>
        <Button type="submit" size="sm" disabled={save.isPending}>
          {save.isPending && <Loader2Icon className="animate-spin" data-icon="inline-start" />} {category ? 'Save category' : 'Add category'}
        </Button>
      </div>
    </form>
  )
}

/** Blog categories: list in storefront order, add, edit, move and delete. */
export function BlogCategoriesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const categories = useBlogCategoriesQuery()
  const reorder = useReorderBlogCategoriesMutation()
  const remove = useDeleteBlogCategoryMutation()
  // undefined: no form; null: new category; a category: editing it.
  const [editing, setEditing] = useState<BlogCategory | null | undefined>(undefined)
  const [deleting, setDeleting] = useState<BlogCategory | null>(null)

  const move = (items: BlogCategory[], index: number, direction: -1 | 1) => {
    const ids = items.map((c) => c.id)
    const [moved] = ids.splice(index, 1)
    if (moved) ids.splice(index + direction, 0, moved)
    reorder.mutate(ids, { onError: (e) => toast.error(e.message) })
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) setEditing(undefined)
          onOpenChange(next)
        }}
      >
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Blog categories</DialogTitle>
            <DialogDescription>Shown as filters on the blog in this order. Deleting a category keeps its posts, uncategorised.</DialogDescription>
          </DialogHeader>

          {categories.isPending ? (
            <LoadingState label="Loading categories" />
          ) : categories.error ? (
            <ErrorState error={categories.error} onRetry={() => categories.refetch()} />
          ) : categories.data.length === 0 && editing === undefined ? (
            <EmptyState title="No categories yet" description="Group posts by topic, e.g. Recipes or Store news." />
          ) : (
            <ol className="flex flex-col divide-y" aria-label="Blog categories">
              {categories.data.map((c, i) =>
                editing?.id === c.id ? (
                  <li key={c.id} className="py-2"><CategoryForm category={c} onDone={() => setEditing(undefined)} /></li>
                ) : (
                  <li key={c.id} className="flex flex-wrap items-center gap-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{c.name}</p>
                      <p className="text-sm text-muted-foreground">
                        <span className="font-mono">/blog/category/{c.slug}</span>
                        {c.post_count !== undefined && ` · ${c.post_count} post${c.post_count === 1 ? '' : 's'}`}
                      </p>
                    </div>
                    <div className="flex items-center">
                      <Button variant="ghost" size="icon-sm" aria-label={`Move ${c.name} up`} disabled={i === 0 || reorder.isPending} onClick={() => move(categories.data, i, -1)}><ArrowUpIcon /></Button>
                      <Button variant="ghost" size="icon-sm" aria-label={`Move ${c.name} down`} disabled={i === categories.data.length - 1 || reorder.isPending} onClick={() => move(categories.data, i, 1)}><ArrowDownIcon /></Button>
                      <Button variant="ghost" size="icon-sm" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)}><PencilIcon /></Button>
                      <Button variant="ghost" size="icon-sm" aria-label={`Delete ${c.name}`} onClick={() => setDeleting(c)}><Trash2Icon /></Button>
                    </div>
                  </li>
                ),
              )}
            </ol>
          )}

          {editing === null ? (
            <CategoryForm category={null} onDone={() => setEditing(undefined)} />
          ) : (
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditing(null)} disabled={!categories.data}><PlusIcon data-icon="inline-start" /> New category</Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => !next && setDeleting(null)}
        title={`Delete ${deleting?.name ?? 'this category'}?`}
        description="Its posts stay on the blog without a category. A category that a menu links to cannot be deleted; remove the link first."
        confirmLabel="Delete category"
        pending={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => {
              toast.success('Category deleted.')
              setDeleting(null)
            },
            onError: (e) => {
              setDeleting(null)
              toast.error(blogDeleteError(e, 'category'))
            },
          })
        }
      />
    </>
  )
}
