import { FormField } from '@/components/common/form-field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useLinkTargetsQuery } from '@/features/storefront/api'
import { BLOG_POSTS_LIMIT, blogPostsSummary, type BlogPostsConfig } from '@/features/storefront/blog-posts-section'

const ALL = 'all'
const range = (min: number, max: number) => Array.from({ length: max - min + 1 }, (_, i) => min + i)

/** Config of the `blog_posts` homepage section; categories come from the menu link targets. */
export function BlogPostsFields({ config, onChange, errors }: { config: BlogPostsConfig; onChange: (config: BlogPostsConfig) => void; errors: Record<string, string> }) {
  const targets = useLinkTargetsQuery()
  const categories = targets.data?.blog_categories ?? []
  const current = config.category_id
  const missing = current !== null && !targets.isPending && !categories.some((c) => c.id === current)

  let hint = 'The newest published posts. The section hides itself while there are none.'
  if (targets.error) hint = 'Blog categories could not be loaded; “All categories” always works.'
  else if (!targets.isPending && categories.length === 0) hint = 'No blog categories yet. Create them under Content → Blog.'

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <FormField label="Blog category" error={errors['config.category_id']} hint={hint} className="sm:col-span-2">
        <Select value={current ?? ALL} onValueChange={(v) => onChange({ ...config, category_id: v === ALL ? null : v })}>
          <SelectTrigger className="w-full sm:w-96" aria-label="Blog category"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All categories</SelectItem>
            {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            {missing && current && <SelectItem value={current}>Chosen category (deleted)</SelectItem>}
          </SelectContent>
        </Select>
      </FormField>
      <FormField label="Number of posts" error={errors['config.limit']}>
        <Select value={String(config.limit)} onValueChange={(v) => onChange({ ...config, limit: Number(v) })}>
          <SelectTrigger className="w-full" aria-label="Number of posts"><SelectValue /></SelectTrigger>
          <SelectContent>{range(BLOG_POSTS_LIMIT.min, BLOG_POSTS_LIMIT.max).map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
        </Select>
      </FormField>
      <FormField label="“View all” link" error={errors['config.view_all_url']} hint="Optional; the blog (/blog) when empty.">
        <Input spellCheck={false} maxLength={255} placeholder="/blog" value={config.view_all_url ?? ''} onChange={(e) => onChange({ ...config, view_all_url: e.target.value || null })} />
      </FormField>
    </div>
  )
}

/** Category and post count of a `blog_posts` section, for the homepage section list. */
export function BlogPostsSummary({ config }: { config: Partial<BlogPostsConfig> }) {
  const targets = useLinkTargetsQuery()
  const byId = new Map((targets.data?.blog_categories ?? []).map((c) => [c.id, c.name]))
  return <>{blogPostsSummary(config, (id) => byId.get(id))}</>
}
