import type { ComponentProps, ReactNode } from 'react'
import { Link } from 'react-router'
import { isInternalLink } from '../theme'

type MenuLinkProps = Omit<ComponentProps<'a'>, 'href' | 'target' | 'rel'> & {
  url: string
  newTab?: boolean
  children: ReactNode
}

/**
 * Site paths navigate inside the SPA; absolute URLs are plain anchors. A new tab never
 * gets access to this window (rel noopener noreferrer).
 */
export function MenuLink({ url, newTab = false, children, ...props }: MenuLinkProps) {
  const tabProps = newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {}

  if (isInternalLink(url)) {
    return (
      <Link to={url} {...tabProps} {...props}>
        {children}
      </Link>
    )
  }

  return (
    <a href={url} {...(newTab ? tabProps : { rel: 'noopener noreferrer' })} {...props}>
      {children}
    </a>
  )
}
