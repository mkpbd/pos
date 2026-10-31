import type { MouseEvent } from 'react'
import { useNavigate } from 'react-router'
import { cn } from '@/lib/utils'
import { isInternalLink } from '../theme'

/**
 * HTML written in the admin's rich text editor. The server sanitized it on save (ADR-009),
 * so it is rendered as is. Clicks on site links navigate inside the app.
 */
export function RichText({ html, className }: { html: string; className?: string }) {
  const navigate = useNavigate()

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const anchor = (e.target as HTMLElement).closest('a')
    const href = anchor?.getAttribute('href')
    if (!anchor || !href || anchor.target || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || !isInternalLink(href)) return
    e.preventDefault()
    void navigate(href)
  }

  return <div className={cn('sf-rich-text', className)} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
}
