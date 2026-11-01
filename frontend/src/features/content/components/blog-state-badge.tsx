import { Badge } from '@/components/ui/badge'
import type { BlogPostState } from '@/features/content/api'
import { BLOG_STATE_LABELS } from '@/features/content/blog'

const VARIANTS: Record<BlogPostState, 'success' | 'info' | 'soft'> = { published: 'success', scheduled: 'info', draft: 'soft' }

export function BlogStateBadge({ state }: { state: BlogPostState }) {
  return <Badge variant={VARIANTS[state]}>{BLOG_STATE_LABELS[state]}</Badge>
}
