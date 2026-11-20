import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router'
import { ExternalLinkIcon, ImageIcon } from 'lucide-react'
import { useLocale } from '../i18n/locale'
import type { AssistantLink, AssistantProduct } from './api'
import type { HandoffTarget } from './handoff'
import { parseAssistantText, safeStorePath, type Inline } from './safe-text'

/** Called when the shopper follows a link inside the chat (the phone layout closes the full-screen panel). */
type Navigate = () => void

const linkClass = 'font-semibold text-sf-link underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent'

function InlineNodes({ nodes, onNavigate }: { nodes: Inline[]; onNavigate: Navigate }) {
  return nodes.map((node, index) => {
    if (node.kind === 'text') return <Fragment key={index}>{node.text}</Fragment>
    if (node.kind === 'bold')
      return (
        <strong key={index} className="font-bold text-sf-heading">
          <InlineNodes nodes={node.children} onNavigate={onNavigate} />
        </strong>
      )
    return (
      <Link key={index} to={node.path} onClick={onNavigate} className={linkClass}>
        {node.label}
      </Link>
    )
  })
}

/** A reply's text: paragraphs, bullet lists, bold and own-store links — React text nodes only, never HTML. */
export function SafeText({ text, onNavigate }: { text: string; onNavigate: Navigate }) {
  const blocks = parseAssistantText(text)
  return (
    <div className="flex flex-col gap-2 break-words">
      {blocks.map((block, index) =>
        block.kind === 'paragraph' ? (
          <p key={index}>
            {block.lines.map((line, at) => (
              <Fragment key={at}>
                {at > 0 && <br />}
                <InlineNodes nodes={line} onNavigate={onNavigate} />
              </Fragment>
            ))}
          </p>
        ) : (
          <ul key={index} className="list-disc ps-5">
            {block.items.map((item, at) => (
              <li key={at}>
                <InlineNodes nodes={item} onNavigate={onNavigate} />
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  )
}

/** A picture address the card may load: http(s) or a path on this store. */
function safeImage(url: string | null): string | null {
  if (!url) return null
  if (url.startsWith('/') && !url.startsWith('//')) return url
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null
  } catch {
    return null
  }
}

/** Up to four product cards the server built from products the tools returned. */
export function ProductCards({ products, onNavigate }: { products: AssistantProduct[]; onNavigate: Navigate }) {
  const { t } = useLocale()
  const cards = products.filter((product) => product.slug && product.name).slice(0, 4)
  if (cards.length === 0) return null
  return (
    <ul aria-label={t('assistant.products')} className="grid grid-cols-2 gap-2" data-testid="assistant-products">
      {cards.map((product) => {
        const image = safeImage(product.image_url)
        return (
          <li key={product.slug}>
            <Link
              to={`/product/${encodeURIComponent(product.slug)}`}
              onClick={onNavigate}
              className="flex h-full flex-col overflow-hidden rounded-sf-card border border-sf-border bg-sf-surface text-start transition hover:border-sf-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent"
            >
              <span className="grid aspect-square place-items-center bg-sf-canvas">
                {image ? (
                  <img src={image} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
                ) : (
                  <ImageIcon aria-hidden className="size-8 text-sf-border" />
                )}
              </span>
              <span className="flex flex-1 flex-col gap-0.5 p-2 text-xs">
                <span className="line-clamp-2 font-semibold text-sf-heading">{product.name}</span>
                <span className="font-bold text-sf-heading">{product.price_text}</span>
                <span className={product.in_stock ? 'text-sf-text' : 'font-semibold text-sf-sale'}>{product.in_stock ? t('assistant.inStock') : t('assistant.outOfStock')}</span>
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

/** Up to three own-store pages the reply points to (FAQ, policies, the shopper's orders). */
export function ReplyLinks({ links, onNavigate }: { links: AssistantLink[]; onNavigate: Navigate }) {
  const { t } = useLocale()
  const safe = links
    .map((link) => ({ label: link.label?.trim(), path: safeStorePath(link.path) }))
    .filter((link): link is { label: string; path: string } => Boolean(link.label && link.path))
    .slice(0, 3)
  if (safe.length === 0) return null
  return (
    <ul aria-label={t('assistant.links')} className="flex flex-wrap gap-2">
      {safe.map((link) => (
        <li key={`${link.path}|${link.label}`}>
          <Link
            to={link.path}
            onClick={onNavigate}
            className="inline-flex min-h-9 items-center rounded-full border border-sf-border bg-sf-surface px-3 text-xs font-semibold text-sf-heading hover:border-sf-accent hover:text-sf-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent"
          >
            {link.label}
          </Link>
        </li>
      ))}
    </ul>
  )
}

const handoffClass =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-sf-button border border-sf-border bg-sf-surface px-4 text-sm font-semibold text-sf-heading transition hover:border-sf-accent hover:text-sf-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent'

/** "Chat with a person on WhatsApp" (new tab) or "Contact the store". */
export function HandoffButton({ target, onNavigate, className, testId }: { target: HandoffTarget; onNavigate: Navigate; className?: string; testId?: string }): ReactNode {
  const { t } = useLocale()
  if (target.kind === 'whatsapp') {
    return (
      <a href={target.href} target="_blank" rel="noopener noreferrer" className={`${handoffClass} ${className ?? ''}`} data-testid={testId}>
        {t('assistant.handoff.whatsapp')}
        <ExternalLinkIcon aria-hidden className="size-4" />{' '}
        <span className="sr-only">{t('social.newTab')}</span>
      </a>
    )
  }
  return (
    <Link to={target.path} onClick={onNavigate} className={`${handoffClass} ${className ?? ''}`} data-testid={testId}>
      {t('assistant.handoff.contact')}
    </Link>
  )
}
