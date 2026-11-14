import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { CheckIcon, LinkIcon, Share2Icon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useStorefront } from '../api'
import { useMediaQuery } from '../components/use-media-query'
import { useLocale } from '../i18n/locale'
import type { MessageKey } from '../i18n/en'
import { withLang } from '../use-document-meta'
import { FacebookGlyph, MessengerGlyph, PinterestGlyph, WhatsAppGlyph, XGlyph, type IconComponent } from './icons'
import { absoluteUrl, SHARE_MEDIUM, SHARE_SOURCE, shareButtonsEnabled, shareHref, taggedLink, type ShareNetwork, type ShareTarget } from './links'

/** Touch-first screens (phones, tablets): the share sheet and the Messenger app live there. */
export const TOUCH_QUERY = '(pointer: coarse)'

/** How long "Link copied" stays on screen. */
const COPIED_MS = 4000

/*
 * Brand colours with a white mark of at least 4.5:1 (WhatsApp's darker teal; Messenger a blue to
 * violet blend whose both ends pass).
 */
const NETWORKS: Record<ShareNetwork, { label: MessageKey; Icon: IconComponent; background: string; newTab: boolean }> = {
  facebook: { label: 'social.share.facebook', Icon: FacebookGlyph, background: '#0866ff', newTab: true },
  messenger: { label: 'social.share.messenger', Icon: MessengerGlyph, background: 'linear-gradient(135deg, #0866ff, #a033ff)', newTab: false },
  whatsapp: { label: 'social.share.whatsapp', Icon: WhatsAppGlyph, background: '#0b7a62', newTab: true },
  x: { label: 'social.share.x', Icon: XGlyph, background: '#000000', newTab: true },
  pinterest: { label: 'social.share.pinterest', Icon: PinterestGlyph, background: '#e60023', newTab: true },
}

const ROUND =
  'grid size-11 place-items-center rounded-full text-white shadow-sm transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent'

const PILL =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-sf-button border border-sf-border bg-sf-surface px-4 py-2 text-sm font-semibold text-sf-heading transition hover:border-sf-accent hover:text-sf-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent'

/** The page's share sheet, when the browser has one (Web Share API). */
function nativeShare(): ((data: ShareData) => Promise<void>) | null {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return null
  return (data) => navigator.share(data)
}

/** Copies text to the clipboard; false when the browser refuses (no permission, an insecure page, an old browser). */
async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return false
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/**
 * P2b: the share bar of a product, campaign page or blog post. On a phone or tablet with a share
 * sheet (Web Share API) it is one "Share" button; otherwise round buttons for Facebook, Messenger
 * (phones only: the app's own link), WhatsApp, X and Pinterest (with a picture only), each opening the
 * network's own share page, and "Copy link" with a polite "Link copied". Every shared address is the
 * page's canonical one in the shopper's language, tagged `utm_source=<network>&utm_medium=share`.
 * Nothing when the owner turned share buttons off, nor in a store preview.
 */
export function ShareBar({ target, label, align = 'start', className }: { target: ShareTarget; label: string; align?: 'start' | 'center'; className?: string }) {
  const { store, preview } = useStorefront()
  if (!shareButtonsEnabled(store) || preview) return null
  return <Bar target={target} label={label} align={align} className={className} />
}

function Bar({ target, label, align, className }: { target: ShareTarget; label: string; align: 'start' | 'center'; className?: string }) {
  const { t, locale, defaultLocale } = useLocale()
  const touch = useMediaQuery(TOUCH_QUERY)
  const [sheetFailed, setSheetFailed] = useState(false)
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle')
  const fieldRef = useRef<HTMLInputElement>(null)
  const labelId = useId()
  const fieldId = useId()

  // The page in the shopper's language (`lang` only when it is not the store default).
  const pageUrl = withLang(absoluteUrl(target.url) ?? target.url, locale, defaultLocale)
  const share: ShareTarget = { ...target, url: pageUrl }
  const sheet = touch && !sheetFailed ? nativeShare() : null

  useEffect(() => {
    if (copy !== 'copied') return
    const timer = window.setTimeout(() => setCopy('idle'), COPIED_MS)
    return () => window.clearTimeout(timer)
  }, [copy])

  // A refused copy shows the link in a field, selected for copying by hand.
  useEffect(() => {
    if (copy === 'failed') fieldRef.current?.select()
  }, [copy])

  const copyLink = async () => {
    setCopy('idle')
    setCopy((await copyText(taggedLink(pageUrl, SHARE_SOURCE.copy, SHARE_MEDIUM))) ? 'copied' : 'failed')
  }

  if (sheet) {
    const open = async () => {
      try {
        await sheet({ title: target.title, url: taggedLink(pageUrl, SHARE_SOURCE.native, SHARE_MEDIUM) })
      } catch (error) {
        // Closing the sheet is not a failure; anything else falls back to the buttons.
        if (!(error instanceof DOMException && error.name === 'AbortError')) setSheetFailed(true)
      }
    }
    return (
      <div className={cn('flex', align === 'center' && 'justify-center', className)} data-testid="share-bar" data-mode="native">
        <button type="button" className={PILL} onClick={() => void open()}>
          <Share2Icon aria-hidden className="size-4" />
          {label}
        </button>
      </div>
    )
  }

  const networks: ShareNetwork[] = ['facebook', ...(touch ? (['messenger'] as const) : []), 'whatsapp', 'x', ...(absoluteUrl(target.image) ? (['pinterest'] as const) : [])]

  return (
    <div
      role="group"
      aria-labelledby={labelId}
      className={cn('flex flex-wrap items-center gap-x-3 gap-y-2', align === 'center' && 'justify-center text-center', className)}
      data-testid="share-bar"
      data-mode="buttons"
    >
      <p id={labelId} className="text-sm font-semibold text-sf-heading">
        {label}
      </p>
      <ul className={cn('flex flex-wrap items-center gap-2', align === 'center' && 'justify-center')}>
        {networks.map((network) => {
          const { label: name, Icon, background, newTab } = NETWORKS[network]
          const style: CSSProperties = { background }
          return (
            <li key={network}>
              <a
                href={shareHref(network, share)}
                className={ROUND}
                style={style}
                data-network={network}
                {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              >
                <Icon aria-hidden className="size-5" />
                <span className="sr-only">
                  {t(name)}
                  {newTab && ` ${t('social.newTab')}`}
                </span>
              </a>
            </li>
          )
        })}
        <li>
          <button type="button" className={PILL} onClick={() => void copyLink()} data-testid="share-copy">
            {copy === 'copied' ? <CheckIcon aria-hidden className="size-4" /> : <LinkIcon aria-hidden className="size-4" />}
            {t('social.share.copy')}
          </button>
        </li>
      </ul>
      <div role="status" className={cn('basis-full text-sm', align === 'center' && 'text-center')} data-testid="share-status">
        {copy === 'copied' && <span className="font-semibold text-sf-highlight">{t('social.share.copied')}</span>}
        {copy === 'failed' && (
          <span className={cn('flex flex-col gap-1.5', align === 'center' && 'items-center')}>
            <label htmlFor={fieldId}>{t('social.share.copyFailed')}</label>
            <input
              id={fieldId}
              ref={fieldRef}
              readOnly
              value={taggedLink(pageUrl, SHARE_SOURCE.copy, SHARE_MEDIUM)}
              aria-label={t('social.share.linkField')}
              onFocus={(event) => event.currentTarget.select()}
              className="min-h-11 w-full max-w-md rounded-md border border-sf-border bg-sf-surface px-3 text-sm text-sf-heading"
            />
          </span>
        )}
      </div>
    </div>
  )
}
