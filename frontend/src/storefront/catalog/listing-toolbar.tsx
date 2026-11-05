import { useId } from 'react'
import { Link } from 'react-router'
import { ChevronLeftIcon, ChevronRightIcon, LayoutGridIcon, ListIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLocale } from '../i18n/locale'
import type { ListingPagination, SortKey } from '../types'
import { PER_PAGE_OPTIONS, SORT_OPTIONS, paginationItems, resultSummary, type ListingView, type PerPage } from './listing-params'

const selectClass = 'h-10 rounded-lg border bg-sf-surface px-3 text-sm text-sf-heading focus-visible:outline-2 focus-visible:outline-sf-accent'

/** Result count, sort, page size and grid/list view above the results. */
export function ListingToolbar({
  pagination,
  sort,
  perPage,
  view,
  onSort,
  onPerPage,
  onView,
}: {
  pagination: ListingPagination | null
  sort: SortKey
  perPage: PerPage
  view: ListingView
  onSort: (sort: SortKey) => void
  onPerPage: (perPage: PerPage) => void
  onView: (view: ListingView) => void
}) {
  const id = useId()
  const { t, formatNumber } = useLocale()

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p role="status" aria-live="polite" className="text-sm" data-testid="result-count">
        {pagination ? resultSummary(pagination, t) : ''}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label htmlFor={`${id}-sort`} className="text-sm">{t('catalog.toolbar.sortBy')}</label>
          <select id={`${id}-sort`} value={sort} onChange={(e) => onSort(e.target.value as SortKey)} className={selectClass}>
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{t(o.label)}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor={`${id}-per-page`} className="text-sm">{t('catalog.toolbar.show')}</label>
          <select id={`${id}-per-page`} value={perPage} onChange={(e) => onPerPage(Number(e.target.value) as PerPage)} className={selectClass}>
            {PER_PAGE_OPTIONS.map((n) => (
              <option key={n} value={n}>{formatNumber(n)}</option>
            ))}
          </select>
        </div>
        <div className="hidden items-center gap-1 sm:flex" role="group" aria-label={t('catalog.toolbar.view')}>
          {(
            [
              ['grid', t('catalog.toolbar.gridView'), LayoutGridIcon],
              ['list', t('catalog.toolbar.listView'), ListIcon],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              aria-label={label}
              aria-pressed={view === value}
              onClick={() => onView(value)}
              className={cn('grid size-10 place-items-center rounded-lg border transition', view === value ? 'border-sf-accent bg-sf-accent text-sf-accent-foreground' : 'bg-sf-surface hover:border-sf-heading')}
            >
              <Icon aria-hidden className="size-4" />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Numbered page links (real links: shareable, crawlable, middle-clickable). */
export function Pagination({ pagination, hrefFor }: { pagination: ListingPagination; hrefFor: (page: number) => string }) {
  const { t, formatNumber } = useLocale()
  const { current_page: current, last_page: last } = pagination
  if (last <= 1) return null

  const item = 'grid h-10 min-w-10 place-items-center rounded-full px-3 text-sm font-semibold transition'
  return (
    <nav aria-label={t('catalog.pagination.label')} className="mt-8">
      <ul className="flex flex-wrap items-center justify-center gap-1.5">
        <li>
          {current > 1 ? (
            <Link to={hrefFor(current - 1)} className={cn(item, 'bg-sf-surface hover:bg-sf-accent hover:text-sf-accent-foreground')} aria-label={t('catalog.pagination.previous')}>
              <ChevronLeftIcon aria-hidden className="size-4" />
            </Link>
          ) : null}
        </li>
        {paginationItems(current, last).map((page, i) => (
          <li key={page ?? `gap-${i}`}>
            {page === null ? (
              <span className="px-1" aria-hidden>…</span>
            ) : (
              <Link
                to={hrefFor(page)}
                aria-label={t('catalog.pagination.page', { page })}
                aria-current={page === current ? 'page' : undefined}
                className={cn(item, page === current ? 'bg-sf-primary text-sf-primary-foreground' : 'bg-sf-surface hover:bg-sf-accent hover:text-sf-accent-foreground')}
              >
                {formatNumber(page)}
              </Link>
            )}
          </li>
        ))}
        <li>
          {current < last ? (
            <Link to={hrefFor(current + 1)} className={cn(item, 'bg-sf-surface hover:bg-sf-accent hover:text-sf-accent-foreground')} aria-label={t('catalog.pagination.next')}>
              <ChevronRightIcon aria-hidden className="size-4" />
            </Link>
          ) : null}
        </li>
      </ul>
    </nav>
  )
}
