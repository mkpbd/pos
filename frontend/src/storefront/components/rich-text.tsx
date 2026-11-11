import type { MouseEvent } from 'react'
import { useNavigate } from 'react-router'
import { cn } from '@/lib/utils'
import { isInternalLink } from '../theme'

/**
 * HTML written in the admin's rich text editor. The server sanitized it on save (ADR-009),
 * so it is rendered as is. Clicks on site links navigate inside the app. `data-*` attributes
 * are passed on (the store builder targets its text elements with `data-b`).
 */
export function RichText({ html, className, ...data }: { html: string; className?: string } & { [attribute: `data-${string}`]: string | undefined }) {
  const navigate = useNavigate()

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const anchor = (e.target as HTMLElement).closest('a')
    const href = anchor?.getAttribute('href')
    if (!anchor || !href || anchor.target || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || !isInternalLink(href)) return
    e.preventDefault()
    void navigate(href)
  }

  return <div {...data} className={cn('sf-rich-text', className)} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
}
