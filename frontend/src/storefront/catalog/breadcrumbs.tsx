import { Link } from 'react-router'
import type { Breadcrumb } from '../types'

/** Breadcrumb trail; the last crumb (no URL) is the current page. */
export function Breadcrumbs({ items, className }: { items: Breadcrumb[]; className?: string }) {
  if (items.length === 0) return null

  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        {items.map((crumb, i) => {
          const last = i === items.length - 1
          return (
            <li key={`${crumb.name}-${i}`} className="flex items-center gap-2">
              {crumb.url && !last ? (
                <Link to={crumb.url} className="transition-colors hover:text-sf-accent hover:underline">
                  {crumb.name}
                </Link>
              ) : (
                <span aria-current={last ? 'page' : undefined} className={last ? 'font-medium text-sf-heading' : undefined}>
                  {crumb.name}
                </span>
              )}
              {!last && <span aria-hidden>/</span>}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
