import { useId, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { MailIcon, MapPinIcon, PhoneIcon } from 'lucide-react'
import { ApiError } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import { useNewsletterMutation, useStorefront } from '../api'
import { useBlogListQuery } from '../blog/api'
import { blogPostUrl, formatPostDate } from '../blog/display'
import { useProductListingQuery } from '../catalog/api'
import { CardPrice, CardRating } from '../catalog/card-parts'
import { useCardPricing } from '../catalog/card-pricing'
import { ProductImage } from '../catalog/product-image'
import { storeFormError } from '../form-errors'
import { useLocale } from '../i18n/locale'
import type { ProductCard, SocialNetwork } from '../types'
import { CURRENT_YEAR, FOOTER_LIST_SIZE, FOOTER_MENUS, FOOTER_PRODUCT_QUERY, SOCIAL_LABELS } from './footer-parts'
import { MediaImage } from './media-image'
import { MenuLink } from './menu-link'

/*
 * Footer variants (T1). `showcase` (handmade): brand column, two product lists and the store's
 * links on a light surface. `widgets` (classic): dark footer of widget columns — about, latest
 * posts, best selling, top rated, newsletter — over a bar with the footer menus. Every data
 * widget hides itself while it has nothing to show.
 */

type Tone = 'light' | 'dark'

function useFooterContent() {
  const { store, theme, menus } = useStorefront()
  const { t, digits } = useLocale()
  const { about, contact, social, payment_logos, copyright } = theme.footer
  const columns = FOOTER_MENUS.flatMap((location) => {
    const menu = menus[location]
    return menu && menu.items.length > 0 ? [{ location, menu }] : []
  })
  const socialLinks = (Object.keys(SOCIAL_LABELS) as SocialNetwork[]).flatMap((network) => (social[network] ? [{ network, url: social[network] }] : []))
  return {
    store,
    theme,
    about,
    contact,
    paymentLogos: payment_logos,
    columns,
    socialLinks,
    hasContact: Boolean(contact.email || contact.phone || contact.address),
    copyright: copyright ?? t('shell.footer.copyright', { year: digits(String(CURRENT_YEAR)), store: store.name }),
  }
}

const HEADING: Record<Tone, string> = {
  light: 'sf-heading-case mb-5 font-heading text-lg font-semibold text-sf-heading',
  dark: "sf-heading-case relative mb-6 pb-3 text-sm font-bold tracking-wider text-sf-surface uppercase after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-8 after:bg-sf-accent",
}

const LINK: Record<Tone, string> = {
  light: 'transition-colors hover:text-sf-accent focus-visible:text-sf-accent',
  dark: 'transition-colors hover:text-sf-surface focus-visible:text-sf-surface',
}

/** A titled footer block (a landmark-free section with its own heading). */
function Widget({ title, tone, children, className, testId }: { title: string; tone: Tone; children: ReactNode; className?: string; testId?: string }) {
  const id = useId()
  return (
    <section aria-labelledby={id} className={className} data-testid={testId}>
      <h2 id={id} className={HEADING[tone]}>
        {title}
      </h2>
      {children}
    </section>
  )
}

function SocialLinks({ links, tone, className }: { links: { network: SocialNetwork; url: string }[]; tone: Tone; className?: string }) {
  const { t } = useLocale()
  if (links.length === 0) return null
  return (
    <ul className={cn('flex flex-wrap gap-2', className)} aria-label={t('shell.footer.social')}>
      {links.map(({ network, url }) => (
        <li key={network}>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              'inline-flex items-center rounded-sf-button border px-3 py-1.5 text-xs font-semibold tracking-wide transition-colors',
              tone === 'dark' ? 'border-white/20 hover:border-sf-surface hover:text-sf-surface' : 'border-sf-border text-sf-heading hover:border-sf-accent hover:text-sf-accent',
            )}
          >
            {SOCIAL_LABELS[network]}
            <span className="sr-only"> {t('shell.footer.newTab')}</span>
          </a>
        </li>
      ))}
    </ul>
  )
}

function PaymentLogos({ logos }: { logos: ReturnType<typeof useFooterContent>['paymentLogos'] }) {
  const { t } = useLocale()
  if (logos.length === 0) return null
  return (
    <ul className="flex flex-wrap items-center gap-2" aria-label={t('shell.footer.paymentMethods')}>
      {logos.map((logo) => (
        <li key={logo.id}>
          <MediaImage media={logo} sizes="64px" className="h-6 w-auto object-contain" />
        </li>
      ))}
    </ul>
  )
}

function ContactList({ contact, tone }: { contact: ReturnType<typeof useFooterContent>['contact']; tone: Tone }) {
  const icon = cn('mt-0.5 size-4 shrink-0', tone === 'dark' ? 'text-sf-surface/60' : 'text-sf-accent')
  return (
    <address className="space-y-2.5 text-sm not-italic">
      {contact.phone && (
        <p className="flex items-start gap-2">
          <PhoneIcon aria-hidden className={icon} />
          <a href={`tel:${contact.phone.replace(/[^\d+]/g, '')}`} className={LINK[tone]}>{contact.phone}</a>
        </p>
      )}
      {contact.email && (
        <p className="flex items-start gap-2">
          <MailIcon aria-hidden className={icon} />
          <a href={`mailto:${contact.email}`} className={cn('break-all', LINK[tone])}>{contact.email}</a>
        </p>
      )}
      {contact.address && (
        <p className="flex items-start gap-2">
          <MapPinIcon aria-hidden className={icon} />
          <span className="whitespace-pre-line">{contact.address}</span>
        </p>
      )}
    </address>
  )
}

/** A product of a footer list: thumbnail, name, stars and price. */
function FooterProduct({ product, tone }: { product: ProductCard; tone: Tone }) {
  const pricing = useCardPricing(product)
  return (
    <li className="flex items-center gap-3.5" data-testid="footer-product">
      <Link to={product.url} tabIndex={-1} aria-hidden className="shrink-0">
        <ProductImage image={product.image} alt="" fit="cover" className="size-16 rounded-sf-card border" />
      </Link>
      <div className="flex min-w-0 flex-col gap-1">
        <Link to={product.url} className={cn('line-clamp-2 text-sm leading-snug font-medium', tone === 'dark' ? 'text-sf-surface hover:underline' : 'text-sf-heading hover:text-sf-accent')}>
          {product.name}
        </Link>
        {/* On the dark footer the star colours come from its `sf-on-dark` class (storefront.css). */}
        <CardRating rating={product.rating} />
        <CardPrice
          product={product}
          pricing={pricing}
          from
          className={cn('text-sm', tone === 'dark' && '[&_[data-testid=compare-price]]:text-sf-surface/60 [&_[data-testid=price]]:text-sf-surface')}
        />
      </div>
    </li>
  )
}

/** The first few products of the listing in an order (popularity, latest, rating); hidden while empty. */
function FooterProductList({ title, order, tone, className }: { title: string; order: keyof typeof FOOTER_PRODUCT_QUERY; tone: Tone; className?: string }) {
  const listing = useProductListingQuery(FOOTER_PRODUCT_QUERY[order])
  const products = listing.data?.products.slice(0, FOOTER_LIST_SIZE) ?? []
  if (products.length === 0) return null
  return (
    <Widget title={title} tone={tone} className={className} testId={`footer-products-${order}`}>
      <ul className="space-y-4">
        {products.map((product) => (
          <FooterProduct key={product.id} product={product} tone={tone} />
        ))}
      </ul>
    </Widget>
  )
}

/** The latest three blog posts; hidden without posts (or without a blog). */
function LatestPosts({ tone }: { tone: Tone }) {
  const { t } = useLocale()
  const blog = useBlogListQuery(null, 1)
  const posts = blog.data?.posts.slice(0, FOOTER_LIST_SIZE) ?? []
  if (posts.length === 0) return null
  return (
    <Widget title={t('theme.footer.latestPosts')} tone={tone} testId="footer-posts">
      <ul className="space-y-4">
        {posts.map((post) => {
          const date = formatPostDate(post.published_at)
          return (
            <li key={post.slug} className="flex items-center gap-3.5">
              {post.cover && (
                <Link to={blogPostUrl(post.slug)} tabIndex={-1} aria-hidden className="shrink-0 overflow-hidden rounded-sf-card">
                  <MediaImage media={post.cover} alt="" sizes="64px" className="size-16 object-cover" />
                </Link>
              )}
              <div className="flex min-w-0 flex-col gap-1">
                <Link to={blogPostUrl(post.slug)} className={cn('line-clamp-2 text-sm leading-snug font-medium', tone === 'dark' ? 'text-sf-surface hover:underline' : 'text-sf-heading hover:text-sf-accent')}>
                  {post.title}
                </Link>
                {date && <time dateTime={post.published_at} className="text-xs">{date}</time>}
              </div>
            </li>
          )
        })}
      </ul>
    </Widget>
  )
}

/** The newsletter sign-up (double opt-in, like the homepage section). */
function NewsletterWidget({ tone }: { tone: Tone }) {
  const id = useId()
  const { t } = useLocale()
  const subscribe = useNewsletterMutation()
  const [email, setEmail] = useState('')

  return (
    <Widget title={t('theme.footer.newsletter')} tone={tone} testId="footer-newsletter">
      <p className="mb-4 text-sm leading-relaxed">{t('theme.footer.newsletterText')}</p>
      {subscribe.isSuccess ? (
        <p role="status" className="text-sm font-semibold">{subscribe.data.message}</p>
      ) : (
        <form
          className="flex flex-col gap-2"
          noValidate
          aria-label={t('theme.footer.newsletter')}
          onSubmit={(e) => {
            e.preventDefault()
            if (email.trim()) subscribe.mutate(email.trim())
          }}
        >
          <label htmlFor={`${id}-email`} className="sr-only">{t('content.section.emailLabel')}</label>
          <input
            id={`${id}-email`}
            type="email"
            required
            autoComplete="email"
            placeholder={t('content.section.emailPlaceholder')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={subscribe.isError ? true : undefined}
            aria-describedby={subscribe.isError ? `${id}-error` : undefined}
            className="h-11 rounded-sf-button border border-sf-border bg-sf-surface px-4 text-sm text-sf-heading placeholder:text-sf-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent"
          />
          <button
            type="submit"
            disabled={subscribe.isPending}
            className="h-11 rounded-sf-button bg-sf-accent px-5 text-xs font-bold tracking-wider text-sf-accent-foreground uppercase transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-70"
          >
            {subscribe.isPending ? t('content.section.sending') : t('theme.footer.subscribe')}
          </button>
          {subscribe.isError && (
            <p id={`${id}-error`} role="alert" className="text-sm font-medium">
              {subscribe.error instanceof ApiError && subscribe.error.code === 'VALIDATION_FAILED' ? t('content.section.emailInvalid') : storeFormError(subscribe.error, t)}
            </p>
          )}
        </form>
      )}
    </Widget>
  )
}

/** Handmade: brand + about + social, "Popular" and "New arrivals" product lists, the store's links; a quiet bottom bar. */
export function ShowcaseFooter() {
  const { store, theme, about, contact, columns, socialLinks, hasContact, paymentLogos, copyright } = useFooterContent()
  const { t } = useLocale()

  return (
    <footer className="mt-auto border-t bg-sf-surface" data-testid="site-footer" data-footer-style="showcase">
      <div className="mx-auto grid max-w-sf gap-12 px-4 py-16 sm:grid-cols-2 lg:grid-cols-4 lg:gap-10">
        <div className="space-y-5" data-testid="footer-brand">
          {theme.logo ? (
            <MediaImage media={theme.logo} alt={store.name} sizes="200px" className="h-12 w-auto max-w-48 object-contain" />
          ) : (
            <p className="font-heading text-3xl font-semibold text-sf-heading">{store.name}</p>
          )}
          {about && <p className="max-w-xs text-sm leading-relaxed whitespace-pre-line">{about}</p>}
          <SocialLinks links={socialLinks} tone="light" />
        </div>

        <FooterProductList title={t('theme.footer.popular')} order="popularity" tone="light" />
        <FooterProductList title={t('theme.footer.new')} order="latest" tone="light" />

        {(columns.length > 0 || hasContact) && (
          <div className="space-y-8">
            {columns.map(({ location, menu }) => (
              <nav key={location} aria-label={menu.name}>
                <h2 className={HEADING.light}>{menu.name}</h2>
                <ul className="space-y-2.5 text-sm">
                  {menu.items.map((item) => (
                    <li key={item.id}>
                      <MenuLink url={item.url} newTab={item.open_in_new_tab} className={LINK.light}>
                        {item.label}
                      </MenuLink>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
            {hasContact && (
              <Widget title={t('shell.footer.contactUs')} tone="light">
                <ContactList contact={contact} tone="light" />
              </Widget>
            )}
          </div>
        )}
      </div>

      <div className="border-t">
        <div className="mx-auto flex max-w-sf flex-col items-center justify-between gap-4 px-4 py-6 text-xs tracking-wide sm:flex-row">
          <p>{copyright}</p>
          <PaymentLogos logos={paymentLogos} />
        </div>
      </div>
    </footer>
  )
}

/** Classic: dark widget columns over a bar with the footer menus, the copyright and payment logos. */
export function WidgetsFooter() {
  const { store, about, contact, columns, socialLinks, hasContact, paymentLogos, copyright } = useFooterContent()
  const { t } = useLocale()
  const menuItems = columns.flatMap(({ menu }) => menu.items)

  return (
    <footer className="sf-on-dark mt-auto bg-sf-heading text-sf-surface/75" data-testid="site-footer" data-footer-style="widgets">
      <div className="mx-auto grid max-w-sf gap-10 px-4 py-14 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]">
        {(about || hasContact || socialLinks.length > 0) && (
          <Widget title={t('theme.footer.about')} tone="dark" testId="footer-about">
            <div className="space-y-4">
              <p className="font-heading text-xl font-bold text-sf-surface">{store.name}</p>
              {about && <p className="text-sm leading-relaxed whitespace-pre-line">{about}</p>}
              {hasContact && <ContactList contact={contact} tone="dark" />}
              <SocialLinks links={socialLinks} tone="dark" />
            </div>
          </Widget>
        )}
        <LatestPosts tone="dark" />
        <FooterProductList title={t('theme.footer.bestSelling')} order="popularity" tone="dark" />
        <FooterProductList title={t('theme.footer.topRated')} order="rating" tone="dark" />
        <NewsletterWidget tone="dark" />
      </div>

      <div className="bg-black/25">
        <div className="mx-auto flex max-w-sf flex-col gap-4 px-4 py-5 text-xs lg:flex-row lg:items-center lg:justify-between">
          {menuItems.length > 0 && (
            <nav aria-label={columns[0]?.menu.name}>
              <ul className="flex flex-wrap gap-x-5 gap-y-2 font-semibold tracking-wide uppercase">
                {menuItems.map((item) => (
                  <li key={item.id}>
                    <MenuLink url={item.url} newTab={item.open_in_new_tab} className={LINK.dark}>
                      {item.label}
                    </MenuLink>
                  </li>
                ))}
              </ul>
            </nav>
          )}
          <p>{copyright}</p>
          <PaymentLogos logos={paymentLogos} />
        </div>
      </div>
    </footer>
  )
}
