import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { XIcon } from 'lucide-react'
import { useStorefront } from '../api'
import { MenuLink } from '../components/menu-link'
import { useLocale } from '../i18n/locale'
import type { StorePopup } from '../types'
import { isPopupBlockedPath, isPopupDue, markPopupShown, popupDelayMs } from './frequency'

function PopupPicture({ popup }: { popup: StorePopup }) {
  const { image, mobile_image: mobile } = popup
  if (!image) return null

  return (
    <picture>
      {mobile && <source media="(max-width: 767px)" srcSet={mobile.srcset} sizes="100vw" />}
      <img
        src={image.url}
        srcSet={image.srcset}
        sizes="(min-width: 640px) 512px, 100vw"
        width={image.width}
        height={image.height}
        alt={image.alt ?? ''}
        decoding="async"
        className="max-h-[50dvh] w-full object-cover"
      />
    </picture>
  )
}

/**
 * The store's live popup banner (bootstrap `popup`), opened after its delay on pages other
 * than cart, checkout and account, at most as often as its frequency allows. A modal dialog:
 * labelled, focus kept inside, closed by Esc, the close button or the overlay; focus goes back
 * where it was.
 */
export function PopupBanner() {
  const { popup } = useStorefront()
  const { t } = useLocale()
  const { pathname } = useLocation()
  const blocked = isPopupBlockedPath(pathname)
  const [shownId, setShownId] = useState<string | null>(null)
  const returnFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!popup || blocked || !isPopupDue(popup)) return
    const timer = window.setTimeout(() => {
      if (!isPopupDue(popup)) return
      markPopupShown(popup)
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setShownId(popup.id)
    }, popupDelayMs(popup))
    return () => window.clearTimeout(timer)
  }, [popup, blocked])

  if (!popup) return null
  // A link in the popup that leads to the cart or checkout closes it too.
  const open = shownId === popup.id && !blocked
  const close = () => setShownId(null)
  const title = popup.title ?? t('promo.popup.specialOffer')

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && close()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none" />
        <DialogPrimitive.Content
          data-testid="popup-banner"
          // Without a subtitle there is nothing to describe the dialog (Radix expects an explicit opt-out).
          {...(popup.subtitle ? {} : { 'aria-describedby': undefined })}
          onCloseAutoFocus={(e) => {
            // There is no trigger to return to: go back to what had focus before it opened.
            e.preventDefault()
            const target = returnFocus.current
            if (target?.isConnected) target.focus()
            else document.getElementById('main')?.focus()
          }}
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[92dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-sf-card bg-sf-surface text-center shadow-xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 motion-reduce:animate-none"
        >
          {popup.image && popup.link_url && !popup.button_label ? (
            <MenuLink url={popup.link_url} onClick={close} aria-label={title} className="block">
              <PopupPicture popup={popup} />
            </MenuLink>
          ) : (
            <PopupPicture popup={popup} />
          )}
          <div className="flex flex-col items-center gap-3 p-6">
            <DialogPrimitive.Title className={popup.title ? 'text-2xl leading-tight font-extrabold' : 'sr-only'}>{title}</DialogPrimitive.Title>
            {popup.subtitle && <DialogPrimitive.Description className="max-w-md">{popup.subtitle}</DialogPrimitive.Description>}
            {popup.button_label && popup.link_url && (
              <MenuLink
                url={popup.link_url}
                onClick={close}
                className="mt-1 inline-flex items-center sf-button rounded-sf-button bg-sf-button px-6 py-3 text-sm font-bold tracking-wide text-sf-button-foreground uppercase transition hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                {popup.button_label}
              </MenuLink>
            )}
          </div>
          <DialogPrimitive.Close
            className="absolute top-3 right-3 grid size-9 place-items-center rounded-full bg-sf-surface/90 text-sf-heading shadow transition hover:bg-sf-surface focus-visible:outline-2 focus-visible:outline-offset-2"
            aria-label={t('common.close')}
          >
            <XIcon aria-hidden className="size-5" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
