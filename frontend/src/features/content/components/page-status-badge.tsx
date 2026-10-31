import { Badge } from '@/components/ui/badge'
import type { CmsPageSummary } from '@/features/content/api'

export function PageStatusBadge({ page }: { page: Pick<CmsPageSummary, 'status' | 'is_visible'> }) {
  if (page.status === 'draft') return <Badge variant="soft">Draft</Badge>
  return page.is_visible ? <Badge variant="success">Published</Badge> : <Badge variant="info">Scheduled</Badge>
}
