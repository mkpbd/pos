import { useLayoutEffect } from 'react'
import { useLocation } from 'react-router'
import { cn } from '@/lib/utils'
import { useStorefront } from '../api'
import { normalizeQuantity } from '../cart/quantity'
import { useLocale } from '../i18n/locale'
import { usePriceFormat } from '../money'
import { usePromotionPricing } from '../promotions/display'
import type { ProductDetail, ProductVariant } from '../types'
import { withLang } from '../use-document-meta'
import { WhatsAppGlyph } from './icons'
import { absoluteUrl, CHAT_MEDIUM, chatPageLink, orderMessage, taggedLink, waChatLink, whatsAppChatNumber, whatsAppOrderNumber } from './links'

/** WhatsApp's darker teal: white text and marks on it pass 4.5:1. */
export const WHATSAPP_GREEN = '#0b7a62'

/** Set on <html> while the chat button shows: the store footer ends with room for it (storefront.css). */
export const CHAT_ATTRIBUTE = 'data-sf-chat'

const ORDER_CLASS =
  'inline-flex min-h-12 w-full basis-full items-center justify-center gap-2 rounded-sf-button px-6 py-3 text-sm font-bold text-white transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent'

/**
 * P2b "Order on WhatsApp" next to "Buy now" on the product page (when the owner turned it on; the
 * flag is false without a number). It opens a chat with the store, the message already typed in the
 * shopper's language: product, chosen option, quantity, price and the product's link (with the
 * variant, tagged `utm_source=whatsapp&utm_medium=chat`). Like "Buy now" it waits for the options
 * to be chosen; a sold-out variant has the back-in-stock form instead (the buy form leaves it out).
 */
export function WhatsAppOrderButton({ product, variant, quantity }: { product: ProductDetail; variant: ProductVariant | null; quantity: string }) {
  const { store } = useStorefront()
  const { t, locale, defaultLocale, formatNumber } = useLocale()
  const format = usePriceFormat()
  const promo = usePromotionPricing(product, variant)
  const number = whatsAppOrderNumber(store)
  if (!number) return null

  const content = (
    <>
      <WhatsAppGlyph aria-hidden className="size-5 shrink-0" />
      {t('social.whatsapp.order')}
    </>
  )
  if (!variant) {
    return (
      <button type="button" disabled className={cn(ORDER_CLASS, 'cursor-not-allowed opacity-60')} style={{ background: WHATSAPP_GREEN }} data-testid="whatsapp-order">
        {content}
      </button>
    )
  }

  const units = normalizeQuantity(quantity, product.allow_decimal ?? false) ?? '1'
  const page = withLang(absoluteUrl(`${product.url}?variant=${encodeURIComponent(variant.id)}`) ?? product.url, locale, defaultLocale)
  const text = orderMessage(t, {
    name: product.name,
    option: product.options.length > 0 ? variant.name : null,
    quantity: formatNumber(units),
    price: format.price(promo ? promo.price : variant.price),
    each: units !== '1',
    link: taggedLink(page, 'whatsapp', CHAT_MEDIUM),
  })

  return (
    <a href={waChatLink(number, text)} target="_blank" rel="noopener noreferrer" className={ORDER_CLASS} style={{ background: WHATSAPP_GREEN }} data-testid="whatsapp-order">
      {content}{' '}
      <span className="sr-only">{t('social.newTab')}</span>
    </a>
  )
}

/**
 * P2b floating WhatsApp chat button: on every store page when the owner turned it on, in the bottom
 * corner above the quick-buy / "Order now" bar and a B8b bottom bar (storefront.css
 * `.sf-whatsapp-chat`). It opens a chat with "Hello! I have a question about this page:" and the
 * page's link (tagged for the chat; tokens and campaign tags dropped). The store layout mounts it,
 * so the builder canvas never shows it.
 */
export function WhatsAppChatButton() {
  const { store } = useStorefront()
  const number = whatsAppChatNumber(store)
  return number ? <ChatButton number={number} /> : null
}

function ChatButton({ number }: { number: string }) {
  const { t, locale, defaultLocale } = useLocale()
  const { pathname, search } = useLocation()

  useLayoutEffect(() => {
    const root = document.documentElement
    root.setAttribute(CHAT_ATTRIBUTE, '')
    return () => root.removeAttribute(CHAT_ATTRIBUTE)
  }, [])

  const link = withLang(chatPageLink({ pathname, search }), locale, defaultLocale)
  return (
    <a
      href={waChatLink(number, t('social.whatsapp.message.chat', { url: link }))}
      target="_blank"
      rel="noopener noreferrer"
      className="sf-whatsapp-chat fixed right-4 z-40 grid size-14 place-items-center rounded-full text-white shadow-lg ring-2 ring-white/80 hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent"
      style={{ background: WHATSAPP_GREEN }}
      data-testid="whatsapp-chat"
    >
      <WhatsAppGlyph aria-hidden className="size-7" />
      <span className="sr-only">
        {t('social.whatsapp.chat')} {t('social.newTab')}
      </span>
    </a>
  )
}
