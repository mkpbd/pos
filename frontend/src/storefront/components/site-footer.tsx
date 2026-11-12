import { MailIcon, MapPinIcon, PhoneIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useStorefront } from '../api'
import { useLocale } from '../i18n/locale'
import { PageRenderer } from '../builder/page-renderer'
import { isBuilderPayload } from '../builder/payload'
import { useStoreLayout } from '../theme'
import { CURRENT_YEAR, FOOTER_MENUS, SOCIAL_LABELS } from './footer-parts'
import { ShowcaseFooter, WidgetsFooter } from './footer-variants'
import type { SocialNetwork } from '../types'
import { MediaImage } from './media-image'
import { MenuLink } from './menu-link'

/** The footer in the theme's `footer_style`: link columns (today's), a product showcase, or widget columns. */
export function SiteFooter() {
  const { footer_style: style } = useStoreLayout()
  const { builder } = useStorefront()
  // B4: a footer designed in the store builder, at every width.
  if (isBuilderPayload(builder?.footer)) {
    return (
      <footer className="mt-auto bg-sf-surface" data-testid="site-footer" data-footer-style="builder">
        <PageRenderer page={builder.footer} testId="builder-footer" scope="footer" />
      </footer>
    )
  }
  if (style === 'showcase') return <ShowcaseFooter />
  if (style === 'widgets') return <WidgetsFooter />
  return <ColumnsFooter />
}

function ColumnsFooter() {
  const { store, theme, menus } = useStorefront()
  const { t, digits } = useLocale()
  const { about, contact, social, payment_logos, copyright } = theme.footer
  const columns = FOOTER_MENUS.flatMap((location) => {
    const menu = menus[location]
    return menu && menu.items.length > 0 ? [{ location, menu }] : []
  })
  const socialLinks = (Object.keys(SOCIAL_LABELS) as SocialNetwork[]).flatMap((network) => (social[network] ? [{ network, url: social[network] }] : []))
  const hasContact = Boolean(contact.email || contact.phone || contact.address)
  // Brand + menus + contact: fewer than four blocks share the row instead of leaving an empty column.
  const blocks = 1 + columns.length + (hasContact ? 1 : 0)

  return (
    <footer className="mt-auto border-t bg-sf-surface" data-testid="site-footer">
      <div className={cn('mx-auto grid max-w-sf gap-10 px-4 py-12 sm:grid-cols-2', blocks === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-4')}>
        <div className="space-y-4">
          <p className="font-heading text-2xl font-extrabold text-sf-accent">{store.name}</p>
          {about && <p className="text-sm leading-relaxed whitespace-pre-line">{about}</p>}
          {payment_logos.length > 0 && (
            <ul className="flex flex-wrap items-center gap-2" aria-label={t('shell.footer.paymentMethods')}>
              {payment_logos.map((logo) => (
                <li key={logo.id}>
                  <MediaImage media={logo} sizes="64px" className="h-6 w-auto object-contain" />
                </li>
              ))}
            </ul>
          )}
        </div>

        {columns.map(({ location, menu }) => (
          <nav key={location} aria-label={menu.name}>
            <h2 className="mb-4 text-sm font-bold tracking-wide uppercase">{menu.name}</h2>
            <ul className="space-y-2 text-sm">
              {menu.items.map((item) => (
                <li key={item.id}>
                  <MenuLink url={item.url} newTab={item.open_in_new_tab} className="transition-colors hover:text-sf-accent">
                    {item.label}
                  </MenuLink>
                </li>
              ))}
            </ul>
          </nav>
        ))}

        {hasContact && (
          <div>
            <h2 className="mb-4 text-sm font-bold tracking-wide uppercase">{t('shell.footer.contactUs')}</h2>
            <address className="space-y-3 text-sm not-italic">
              {contact.email && (
                <p className="flex items-start gap-2">
                  <MailIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-sf-accent" />
                  <a href={`mailto:${contact.email}`} className="break-all transition-colors hover:text-sf-accent">{contact.email}</a>
                </p>
              )}
              {contact.phone && (
                <p className="flex items-start gap-2">
                  <PhoneIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-sf-accent" />
                  <a href={`tel:${contact.phone.replace(/[^\d+]/g, '')}`} className="transition-colors hover:text-sf-accent">{contact.phone}</a>
                </p>
              )}
              {contact.address && (
                <p className="flex items-start gap-2">
                  <MapPinIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-sf-accent" />
                  <span className="whitespace-pre-line">{contact.address}</span>
                </p>
              )}
            </address>
          </div>
        )}
      </div>

      {socialLinks.length > 0 && (
        <div className="border-t">
          <ul className="mx-auto flex max-w-sf flex-wrap justify-center gap-x-8 gap-y-2 px-4 py-5 text-sm font-medium" aria-label={t('shell.footer.social')}>
            {socialLinks.map(({ network, url }) => (
              <li key={network}>
                <a href={url} target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-sf-accent">
                  {SOCIAL_LABELS[network]}
                  <span className="sr-only"> {t('shell.footer.newTab')}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="bg-sf-accent px-4 py-4 text-center text-sm text-sf-accent-foreground">
        {copyright ?? t('shell.footer.copyright', { year: digits(String(CURRENT_YEAR)), store: store.name })}
      </div>
    </footer>
  )
}
