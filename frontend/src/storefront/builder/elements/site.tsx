import { useId } from 'react'
import { MailIcon, MapPinIcon, PhoneIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useStorefront } from '../../api'
import { AnnouncementBar } from '../../components/announcement-bar'
import { CURRENT_YEAR, SOCIAL_LABELS } from '../../components/footer-parts'
import { AccountMenu, CartButton, CartTotalButton, WishlistLink } from '../../components/header-actions'
import { HeaderSearch } from '../../components/header-search'
import { LanguageSwitcher } from '../../components/language-switcher'
import { MainNav } from '../../components/main-nav'
import { MediaImage } from '../../components/media-image'
import { MenuLink } from '../../components/menu-link'
import { useLocale } from '../../i18n/locale'
import { parseLocale } from '../../i18n/runtime'
import type { MenuNode, SocialNetwork } from '../../types'
import { colorCss } from '../compile-styles'
import { SOCIAL_GLYPHS } from '../icons'
import { DraftPlaceholder } from '../preview-mark'
import type { MenuData } from '../types'
import { isMenuData } from './guards'
import { B4_ENUMS, B4_LIMITS, boundedInt, oneOf, safeLink } from '../validate'
import { bool, str, type El } from './shared'
import { WithData } from './with-data'

/*
 * Header and footer parts. Everything comes from the bootstrap (theme logo, footer contact, social
 * links, payment logos, announcement, languages) or from the element's resolved data (menus), so
 * the editor canvas draws them without a request of its own.
 */

/** The theme logo (or the store name in the heading font) linking home, at a set height. */
export function LogoElement({ element }: { element: El<'logo'> }) {
  const { store, theme } = useStorefront()
  const { t } = useLocale()
  const height = boundedInt(element.props?.height, B4_LIMITS.logoHeight.min, B4_LIMITS.logoHeight.max, 48)
  const url = safeLink(element.props?.link) ?? '/'
  return (
    <MenuLink data-b={element.id} url={url} className="b-logo inline-flex max-w-full items-center" aria-label={t('common.storeHome', { store: store.name })} data-testid="builder-logo">
      {theme.logo ? (
        <MediaImage media={theme.logo} alt={store.name} sizes={`${Math.round(height * 4)}px`} loading="eager" className="w-auto max-w-full object-contain" style={{ height }} />
      ) : (
        <span className="truncate font-heading font-extrabold text-sf-heading" style={{ fontSize: Math.round(height * 0.6) }}>
          {store.name}
        </span>
      )}
    </MenuLink>
  )
}

/** Sub-items as the element asks: none, or (header) dropdowns / mega panels (plain dropdowns when `dropdown`). */
function menuItems(items: MenuNode[], children: 'none' | 'dropdown' | 'mega' | 'list'): MenuNode[] {
  if (children === 'none') return items.map((item) => ({ ...item, children: [], is_mega: false, image: null }))
  if (children === 'dropdown') return items.map((item) => ({ ...item, is_mega: false }))
  return items
}

/** A store menu: a horizontal bar with dropdowns (the header navigation), or a list (footer, vertical). */
export function MenuElement({ element }: { element: El<'menu'> }) {
  return <WithData element={element} is={isMenuData}>{(menu) => <MenuBody element={element} menu={menu} />}</WithData>
}

function MenuBody({ element, menu }: { element: El<'menu'>; menu: MenuData }) {
  const { t } = useLocale()
  const p = element.props ?? {}
  const layout = oneOf(p.layout, B4_ENUMS.menuLayout) ?? 'horizontal'
  const children = oneOf(p.show_children, [...B4_ENUMS.menuChildrenHeader, 'list'] as const) ?? 'none'
  const items = menuItems(Array.isArray(menu.items) ? menu.items : [], children)
  const label = menu.name || t('content.builder.menu')
  if (items.length === 0) return <DraftPlaceholder element={element} />

  if (layout === 'horizontal' && (children === 'dropdown' || children === 'mega')) {
    return (
      <div data-b={element.id} className="b-menu" data-testid="builder-menu">
        <MainNav items={items} appearance="builder" label={label} bare />
      </div>
    )
  }

  const linkClass = 'transition-colors hover:text-sf-accent focus-visible:text-sf-accent'
  return (
    <nav data-b={element.id} aria-label={label} className="b-menu" data-testid="builder-menu">
      <ul className={cn('text-sm', layout === 'horizontal' ? 'flex flex-wrap items-center gap-x-6 gap-y-2' : 'space-y-2')}>
        {items.map((item) => (
          <li key={item.id}>
            <MenuLink url={item.url} newTab={item.open_in_new_tab} className={linkClass}>
              {item.label}
            </MenuLink>
            {children === 'list' && item.children.length > 0 && (
              <ul className="mt-2 space-y-1.5 pl-4">
                {item.children.map((child) => (
                  <li key={child.id}>
                    <MenuLink url={child.url} newTab={child.open_in_new_tab} className={linkClass}>
                      {child.label}
                    </MenuLink>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </nav>
  )
}

/** The header product search (suggestions as you type) with the element's texts. */
export function SearchBoxElement({ element }: { element: El<'search_box'> }) {
  return (
    <div data-b={element.id} className="b-search w-full">
      <HeaderSearch placeholder={str(element.props?.placeholder) || undefined} buttonLabel={str(element.props?.button_label) || undefined} />
    </div>
  )
}

export function AccountLinkElement({ element }: { element: El<'account_link'> }) {
  return (
    <div data-b={element.id} className="b-account inline-flex">
      <AccountMenu label={bool(element.props?.show_label, false) ? 'always' : 'never'} />
    </div>
  )
}

export function WishlistLinkElement({ element }: { element: El<'wishlist_link'> }) {
  return (
    <div data-b={element.id} className="b-wishlist inline-flex">
      <WishlistLink label={bool(element.props?.show_label, false) ? 'always' : 'never'} />
    </div>
  )
}

/** The cart (opens the mini cart), with its item count and optionally its total. */
export function CartIconElement({ element }: { element: El<'cart_icon'> }) {
  const showCount = bool(element.props?.show_count, true)
  return (
    <div data-b={element.id} className="b-cart inline-flex">
      {bool(element.props?.show_total, false) ? <CartTotalButton showCount={showCount} /> : <CartButton showCount={showCount} />}
    </div>
  )
}

/** English / বাংলা as links (the header switcher) or a select; nothing when the store has one language. */
export function LanguageSwitchElement({ element }: { element: El<'language_switch'> }) {
  const id = useId()
  const { locale, locales, setLocale, t } = useLocale()
  if (!locales.includes('en') || !locales.includes('bn')) return <DraftPlaceholder element={element} />
  if (oneOf(element.props?.style, B4_ENUMS.languageStyle) !== 'select') {
    return (
      <div data-b={element.id} className="b-language inline-flex">
        <LanguageSwitcher />
      </div>
    )
  }
  return (
    <div data-b={element.id} className="b-language inline-flex items-center gap-2 text-sm" data-testid="language-switcher">
      <label htmlFor={`${id}-lang`} className="sr-only">{t('common.language.label')}</label>
      <select
        id={`${id}-lang`}
        value={locale}
        onChange={(e) => {
          const next = parseLocale(e.target.value)
          if (next && next !== locale) setLocale(next)
        }}
        className="h-9 rounded-sf-button border border-sf-border bg-sf-surface px-3 font-semibold text-sf-heading"
      >
        {(['en', 'bn'] as const).map((option) => (
          <option key={option} value={option} lang={option}>
            {t(`common.language.${option}`)}
          </option>
        ))}
      </select>
    </div>
  )
}

/** The theme's announcement (text, link, colours; the server applies its schedule). */
export function AnnouncementElement({ element }: { element: El<'announcement'> }) {
  const { theme } = useStorefront()
  if (!theme.announcement) return <DraftPlaceholder element={element} />
  return (
    <div data-b={element.id} className="b-announcement">
      <AnnouncementBar announcement={theme.announcement} />
    </div>
  )
}

const SOCIAL_SHAPES = {
  plain: '',
  circle: 'rounded-full border-2 border-current p-2',
  square: 'rounded-md border-2 border-current p-2',
} as const

/** The theme footer's social links as icons (each opens in a new tab and is named for readers). */
export function SocialIconsElement({ element }: { element: El<'social_icons'> }) {
  const { theme } = useStorefront()
  const { t } = useLocale()
  const p = element.props ?? {}
  const size = boundedInt(p.size, B4_LIMITS.socialSize.min, B4_LIMITS.socialSize.max, 24)
  const style = oneOf(p.style, B4_ENUMS.socialStyle) ?? 'plain'
  const color = colorCss(p.color)
  const social = theme.footer.social ?? {}
  const links = (Object.keys(SOCIAL_LABELS) as SocialNetwork[]).flatMap((network) => {
    const url = social[network]
    return typeof url === 'string' && /^https?:\/\//i.test(url) ? [{ network, url }] : []
  })
  if (links.length === 0) return <DraftPlaceholder element={element} />

  return (
    <ul data-b={element.id} className="b-social flex flex-wrap items-center gap-3" aria-label={t('shell.footer.social')} style={color ? { color } : undefined} data-testid="builder-social">
      {links.map(({ network, url }) => {
        const Glyph = SOCIAL_GLYPHS[network]
        return (
          <li key={network}>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${SOCIAL_LABELS[network]} ${t('shell.footer.newTab')}`}
              className={cn('inline-flex items-center justify-center transition-opacity hover:opacity-75', SOCIAL_SHAPES[style])}
            >
              <Glyph size={size} aria-hidden />
            </a>
          </li>
        )
      })}
    </ul>
  )
}

/** The theme footer's payment logos. */
export function PaymentIconsElement({ element }: { element: El<'payment_icons'> }) {
  const { theme } = useStorefront()
  const { t } = useLocale()
  const height = boundedInt(element.props?.height, B4_LIMITS.paymentHeight.min, B4_LIMITS.paymentHeight.max, 24)
  const logos = theme.footer.payment_logos ?? []
  if (logos.length === 0) return <DraftPlaceholder element={element} />
  return (
    <ul data-b={element.id} className="b-payment flex flex-wrap items-center gap-2" aria-label={t('shell.footer.paymentMethods')} data-testid="builder-payment">
      {logos.map((logo) => (
        <li key={logo.id}>
          <MediaImage media={logo} sizes={`${height * 3}px`} className="w-auto object-contain" style={{ height }} />
        </li>
      ))}
    </ul>
  )
}

/** The theme footer's phone, e-mail and address (each optional), stacked or in a row. */
export function ContactBlockElement({ element }: { element: El<'contact_block'> }) {
  const { contact } = useStorefront().theme.footer
  const p = element.props ?? {}
  const layout = oneOf(p.layout, B4_ENUMS.blockLayout) ?? 'stacked'
  const phone = bool(p.show_phone, true) ? contact.phone : null
  const email = bool(p.show_email, true) ? contact.email : null
  const address = bool(p.show_address, true) ? contact.address : null
  if (!phone && !email && !address) return <DraftPlaceholder element={element} />
  const icon = 'mt-0.5 size-4 shrink-0 text-sf-accent'
  return (
    <address data-b={element.id} className={cn('b-contact text-sm not-italic', layout === 'inline' ? 'flex flex-wrap gap-x-6 gap-y-2' : 'space-y-2.5')} data-testid="builder-contact">
      {phone && (
        <p className="flex items-start gap-2">
          <PhoneIcon aria-hidden className={icon} />
          <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} className="transition-colors hover:text-sf-accent">{phone}</a>
        </p>
      )}
      {email && (
        <p className="flex items-start gap-2">
          <MailIcon aria-hidden className={icon} />
          <a href={`mailto:${email}`} className="break-all transition-colors hover:text-sf-accent">{email}</a>
        </p>
      )}
      {address && (
        <p className="flex items-start gap-2">
          <MapPinIcon aria-hidden className={icon} />
          <span className="whitespace-pre-line">{address}</span>
        </p>
      )}
    </address>
  )
}

/** The copyright line: the element's text, else the theme's, else "© {year} {store}"; `{year}` is this year. */
export function CopyrightElement({ element }: { element: El<'copyright'> }) {
  const { store, theme } = useStorefront()
  const { t, digits } = useLocale()
  const year = digits(String(CURRENT_YEAR))
  const own = typeof element.props?.text === 'string' && element.props.text.trim() ? element.props.text : null
  const text = (own ?? theme.footer.copyright ?? t('shell.footer.copyright', { year, store: store.name })).replaceAll('{year}', year)
  return (
    <p data-b={element.id} className="b-copyright text-sm" data-testid="builder-copyright">
      {text}
    </p>
  )
}
