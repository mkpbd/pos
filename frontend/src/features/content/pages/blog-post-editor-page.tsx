import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowLeftIcon, ExternalLinkIcon, EyeIcon, Loader2Icon, Trash2Icon } from 'lucide-react'
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
import { useAuth } from '@/features/auth/use-auth'
import { useBlogCategoriesQuery, useBlogPostQuery, useDeleteBlogPostMutation, useSaveBlogPostMutation, type BlogPost } from '@/features/content/api'
import { BLOG_LIMITS, blogDeleteError, blogPostPath, toBlogDraft, toBlogInput, validateBlogDraft, type BlogDraft, type PublishMode } from '@/features/content/blog'
import { BlogStateBadge } from '@/features/content/components/blog-state-badge'
import { RichTextEditor } from '@/features/content/components/rich-text-editor'
import { slugify } from '@/features/content/slug'
import { MediaField } from '@/features/media/components/media-picker'
import { BanglaTranslations } from '@/features/translations/components/bangla-translations'
import { bnErrors } from '@/features/translations/translations'
import { fieldErrorMap } from '@/lib/forms'

const NONE = 'none'

const MODES: { value: PublishMode; label: string; hint: string }[] = [
  { value: 'draft', label: 'Draft', hint: 'Hidden from visitors.' },
  { value: 'now', label: 'Publish now', hint: 'Visible on the blog right after saving.' },
  { value: 'schedule', label: 'Schedule', hint: 'Goes live by itself at the chosen time.' },
]

function Counter({ value, max }: { value: string; max: number }) {
  return <>{value.length}/{max}</>
}

function Editor({ post }: { post?: BlogPost }) {
  const navigate = useNavigate()
  const me = useAuth()
  const timeZone = me.organization?.timezone
  const save = useSaveBlogPostMutation()
  const remove = useDeleteBlogPostMutation()
  const categories = useBlogCategoriesQuery()
  const [draft, setDraft] = useState<BlogDraft>(() => toBlogDraft(post, timeZone))
  const [slugTouched, setSlugTouched] = useState(post !== undefined)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [deleting, setDeleting] = useState(false)
  const set = (patch: Partial<BlogDraft>) => setDraft((d) => ({ ...d, ...patch }))
  const categoryMissing = draft.categoryId !== null && !!categories.data && !categories.data.some((c) => c.id === draft.categoryId)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const local = validateBlogDraft(draft, timeZone)
    if (Object.keys(local).length > 0) return setErrors(local)
    setErrors({})

    save.mutate(
      { id: post?.id, input: toBlogInput(draft, post, timeZone) },
      {
        onSuccess: (saved) => {
          const verb = saved.state === 'scheduled' ? 'scheduled' : saved.state === 'published' ? 'published' : 'saved as a draft'
          toast.success(`Post ${verb}.`)
          setDraft(toBlogDraft(saved, timeZone))
          if (!post) void navigate(`/content/blog/${saved.id}`, { replace: true })
        },
        onError: (error) => {
          const map = fieldErrorMap(error)
          setErrors(map)
          if (map.form) toast.error(map.form)
        },
      },
    )
  }

  const submitLabel = draft.mode === 'draft' ? 'Save draft' : draft.mode === 'schedule' ? 'Schedule post' : post?.state === 'published' ? 'Save post' : 'Publish post'

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-6">
      <PageHeader
        title={post ? post.title : 'New blog post'}
        description={post ? blogPostPath(post.slug) : 'A post for the blog of your online store.'}
        actions={
          <>
            <Button asChild variant="ghost">
              <Link to="/content/blog"><ArrowLeftIcon data-icon="inline-start" /> All posts</Link>
            </Button>
            {post && (
              <Button asChild variant="outline">
                {post.state === 'published' ? (
                  <a href={blogPostPath(post.slug)} target="_blank" rel="noreferrer"><ExternalLinkIcon data-icon="inline-start" /> View in store</a>
                ) : (
                  <a href={blogPostPath(post.slug, true)} target="_blank" rel="noreferrer"><EyeIcon data-icon="inline-start" /> Preview</a>
                )}
              </Button>
            )}
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2Icon className="animate-spin" data-icon="inline-start" />} {submitLabel}
            </Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardContent className="flex flex-col gap-4">
            <FormField label="Title" error={errors.title} hint={<Counter value={draft.title} max={BLOG_LIMITS.title} />}>
              <Input
                maxLength={BLOG_LIMITS.title}
                value={draft.title}
                onChange={(e) => set(slugTouched ? { title: e.target.value } : { title: e.target.value, slug: slugify(e.target.value) })}
              />
            </FormField>
            <FormField label="Address" error={errors.slug} hint={`Shown at ${blogPostPath(draft.slug || 'your-address')}`}>
              <Input
                maxLength={BLOG_LIMITS.slug}
                spellCheck={false}
                value={draft.slug}
                onChange={(e) => {
                  setSlugTouched(true)
                  set({ slug: e.target.value.toLowerCase() })
                }}
              />
            </FormField>
            <FormField label="Excerpt" error={errors.excerpt} hint={<>Shown on the blog cards. Optional. <Counter value={draft.excerpt} max={BLOG_LIMITS.excerpt} /></>}>
              <Textarea rows={3} maxLength={BLOG_LIMITS.excerpt} value={draft.excerpt} onChange={(e) => set({ excerpt: e.target.value })} />
            </FormField>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="post-body">Text</Label>
              <RichTextEditor id="post-body" label="Post text" value={draft.body} onChange={(body) => set({ body })} invalid={!!errors.body_html} />
              {errors.body_html && <p className="text-sm text-destructive">{errors.body_html}</p>}
            </div>
            <BanglaTranslations
              fields={[
                { name: 'title', label: 'Title', base: draft.title, max: BLOG_LIMITS.title },
                { name: 'excerpt', label: 'Excerpt', base: draft.excerpt, kind: 'textarea', rows: 3, max: BLOG_LIMITS.excerpt },
                { name: 'body_html', label: 'Post text', base: draft.body, kind: 'rich' },
                { name: 'seo_title', label: 'SEO title', base: draft.seoTitle, max: BLOG_LIMITS.seoTitle },
                { name: 'seo_description', label: 'Meta description', base: draft.seoDescription, kind: 'textarea', rows: 3, max: BLOG_LIMITS.seoDescription },
              ]}
              value={draft.bn}
              onChange={(bn) => set({ bn })}
              errors={bnErrors(errors)}
            />
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2">Publishing {post && <BlogStateBadge state={post.state} />}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <fieldset className="flex flex-col gap-3">
                <legend className="sr-only">Publishing</legend>
                {MODES.map((m) => (
                  <div key={m.value} className="flex items-start gap-2">
                    <input
                      type="radio"
                      name="publish-mode"
                      id={`publish-${m.value}`}
                      value={m.value}
                      checked={draft.mode === m.value}
                      onChange={() => set({ mode: m.value })}
                      aria-describedby={`publish-${m.value}-hint`}
                      className="mt-0.5 size-4 accent-primary"
                    />
                    <div className="flex flex-col">
                      <Label htmlFor={`publish-${m.value}`}>{m.label}</Label>
                      <span id={`publish-${m.value}-hint`} className="text-xs text-muted-foreground">{m.hint}</span>
                    </div>
                  </div>
                ))}
              </fieldset>
              {draft.mode === 'schedule' && (
                <FormField label="Publish at" error={errors.published_at} hint={timeZone ? `Time in ${timeZone}.` : undefined}>
                  <Input type="datetime-local" value={draft.publishAt} onChange={(e) => set({ publishAt: e.target.value })} />
                </FormField>
              )}
              {draft.mode === 'now' && post?.state === 'published' && post.published_at && (
                <p className="text-xs text-muted-foreground">Published {new Date(post.published_at).toLocaleString(undefined, { timeZone, dateStyle: 'medium', timeStyle: 'short' })}; saving keeps that date.</p>
              )}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="post-category">Category</Label>
                <Select value={draft.categoryId ?? NONE} onValueChange={(v) => set({ categoryId: v === NONE ? null : v })}>
                  <SelectTrigger id="post-category" aria-invalid={errors.category_id ? true : undefined}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Uncategorised</SelectItem>
                    {(categories.data ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    {categoryMissing && draft.categoryId && <SelectItem value={draft.categoryId}>{post?.category?.name ?? 'Current category'}</SelectItem>}
                  </SelectContent>
                </Select>
                {errors.category_id ? (
                  <p className="text-sm text-destructive">{errors.category_id}</p>
                ) : (
                  categories.data?.length === 0 && <p className="text-sm text-muted-foreground">No categories yet; add them with “Categories” on the blog list.</p>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Cover image</Label>
                <MediaField value={draft.coverId} onChange={(coverId) => set({ coverId })} title="Cover image" />
                {errors.cover_media_id && <p className="text-sm text-destructive">{errors.cover_media_id}</p>}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Search engines</CardTitle>
              <CardDescription>Optional. Defaults to the title and the excerpt.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <FormField label="SEO title" error={errors.seo_title} hint={<Counter value={draft.seoTitle} max={BLOG_LIMITS.seoTitle} />}>
                <Input maxLength={BLOG_LIMITS.seoTitle} value={draft.seoTitle} onChange={(e) => set({ seoTitle: e.target.value })} />
              </FormField>
              <FormField label="Meta description" error={errors.seo_description} hint={<Counter value={draft.seoDescription} max={BLOG_LIMITS.seoDescription} />}>
                <Textarea maxLength={BLOG_LIMITS.seoDescription} rows={3} value={draft.seoDescription} onChange={(e) => set({ seoDescription: e.target.value })} />
              </FormField>
            </CardContent>
          </Card>

          {post && (
            <Button type="button" variant="ghost" className="self-start text-destructive" onClick={() => setDeleting(true)}>
              <Trash2Icon data-icon="inline-start" /> Delete post
            </Button>
          )}
        </div>
      </div>

      {post && (
        <ConfirmDialog
          open={deleting}
          onOpenChange={setDeleting}
          title="Delete this post?"
          description="Visitors will no longer find it. A post that a menu links to cannot be deleted; remove the link first."
          confirmLabel="Delete post"
          pending={remove.isPending}
          onConfirm={() =>
            remove.mutate(post.id, {
              onSuccess: () => {
                toast.success('Post deleted.')
                void navigate('/content/blog')
              },
              onError: (error) => {
                setDeleting(false)
                toast.error(blogDeleteError(error, 'post'))
              },
            })
          }
        />
      )}
    </form>
  )
}

/** /content/blog/new and /content/blog/:postId */
export function BlogPostEditorPage() {
  const { postId } = useParams()
  const query = useBlogPostQuery(postId)

  if (!postId) return <Editor />
  if (query.isPending) return <LoadingState label="Loading post" />
  if (query.error) return <ErrorState error={query.error} onRetry={() => query.refetch()} />
  return <Editor key={query.data.id} post={query.data} />
}
