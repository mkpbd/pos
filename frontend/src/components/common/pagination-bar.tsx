import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Pagination } from '@/lib/api/client'

export function PaginationBar({ pagination, onPageChange }: { pagination: Pagination; onPageChange: (page: number) => void }) {
  const { current_page, last_page, total, per_page } = pagination
  if (total === 0) return null

  const from = (current_page - 1) * per_page + 1
  const to = Math.min(current_page * per_page, total)

  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
      <span>
        {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon-sm" aria-label="Previous page" disabled={current_page <= 1} onClick={() => onPageChange(current_page - 1)}>
          <ChevronLeftIcon />
        </Button>
        <span className="px-2">
          Page {current_page} of {last_page}
        </span>
        <Button variant="outline" size="icon-sm" aria-label="Next page" disabled={current_page >= last_page} onClick={() => onPageChange(current_page + 1)}>
          <ChevronRightIcon />
        </Button>
      </div>
    </nav>
  )
}
