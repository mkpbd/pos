/*
 * Content tab forms of the B4 elements (contract §2): video, icon, countdown, discount, call to
 * action, search box, promoted product, newsletter form, FAQ list, contact form, custom HTML and
 * the header / footer parts (logo, menu, account, wishlist, cart, language switch, announcement,
 * social and payment icons, contact details, copyright). Texts marked ✱ in the contract have a
 * Bangla field when Bangla is enabled.
 */

import { CircleAlertIcon, LockIcon, PlayCircleIcon } from 'lucide-react'
import { FormField } from '@/components/common/form-field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { TranslationField } from '@/features/translations/translations'
import { ICON_NAMES } from '@/storefront/builder/icons'
import type {
  AccountLinkElement,
  CartIconElement,
  ContactBlockElement,
  ContactFormElement,
  CopyrightElement,
  CountdownElement,
  CtaElement,
  CustomHtmlElement,
  DiscountElement,
  DocumentContext,
  Element,
  FaqListElement,
  IconElement,
  LanguageSwitchElement,
  LogoElement,
  MenuElement,
  NewsletterFormElement,
  PaymentIconsElement,
  PromoCardElement,
  SearchBoxElement,
  SocialIconsElement,
  VideoElement,
  WishlistLinkElement,
} from '@/storefront/builder/types'
import { parseVideoUrl } from '@/storefront/builder/validate'
import { ColorControl } from '../controls'
import type { FormProps } from './content-forms'
import { FieldError, LinkField, NodeBangla } from './fields'
import { counter } from './format-text'
import { ChoiceField, CouponPreview, IconPicker, ManageLink, MenuPicker, PixelField, PromotionPicker, SingleProductPicker, TextField, ToggleField, ZonedDateTimeField } from './pickers'
import { B4_BOUNDS, B4_TEXT_LIMITS } from './validate'

export type B4FormProps<N> = FormProps<N> & {
  /** Where the document shows (menus offer different sub-item styles in the header and footer). */
  context: DocumentContext
  theme?: { colors?: Record<string, string>; palette?: readonly { name: string; hex: string }[] }
  /** Icon names the server accepts (GET /elements `enums.icons`). */
  icons?: readonly string[]
  /** The user may add or change custom HTML (`storefront.custom_html`). */
  canCustomHtml?: boolean
}

type AnyB4 = Element & { props: Record<string, unknown> }

function patch<N extends AnyB4>(node: N, onChange: FormProps<N>['onChange'], values: Partial<N['props']>, key?: string) {
  onChange({ ...node, props: { ...node.props, ...values } }, key ? { coalesceKey: `${node.id}:${key}` } : undefined)
}

const limit = (type: string, field: string) => B4_TEXT_LIMITS[type]?.[field] ?? 255

/** The Bangla fields of a node (translatable props of the type, with labels). */
function Bangla<N extends AnyB4>({ node, onChange, errors, bangla, fields }: FormProps<N> & { fields: (Omit<TranslationField, 'max'> & { max?: number })[] }) {
  if (!bangla) return null
  return (
    <NodeBangla
      fields={fields.map((f) => ({ ...f, max: f.max ?? limit(node.type, f.name) }))}
      translations={node.translations}
      errors={errors}
      onChange={(translations) => onChange({ ...node, translations }, { coalesceKey: `${node.id}:bn` })}
    />
  )
}

const ALIGN_OPTIONS = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Centre' },
  { value: 'right', label: 'Right' },
] as const

const LAYOUT_OPTIONS = [
  { value: 'stacked', label: 'Stacked' },
  { value: 'inline', label: 'In one line' },
] as const

/* ----------------------------------------------------------------------------------------------
 * Video
 * -------------------------------------------------------------------------------------------- */

const PROVIDER_NAMES = { youtube: 'YouTube', vimeo: 'Vimeo' } as const

export function VideoForm(props: B4FormProps<VideoElement>) {
  const { node, onChange, errors } = props
  const p = node.props
  const detected = parseVideoUrl(p.url.trim())
  const setUrl = (url: string) => {
    const parsed = parseVideoUrl(url.trim())
    // Normalize stores the provider and id from the URL; mirror it so the canvas plays the right video.
    patch(node, onChange, parsed ? { url, provider: parsed.provider, video_id: parsed.video_id } : { url, video_id: '' }, 'url')
  }
  return (
    <div className="flex flex-col gap-4">
      <FormField
        label="Video link"
        error={errors.url}
        hint={detected ? undefined : 'A YouTube link (youtube.com/watch?v=…, youtu.be/…, Shorts) or a Vimeo link (vimeo.com/123456).'}
      >
        <Input inputMode="url" spellCheck={false} maxLength={B4_BOUNDS.videoUrl} placeholder="https://www.youtube.com/watch?v=…" value={p.url} onChange={(e) => setUrl(e.target.value)} />
      </FormField>
      {detected && !errors.url && (
        <p className="flex items-center gap-1.5 text-sm text-success-soft-foreground" role="status" data-testid="video-detected">
          <PlayCircleIcon className="size-4" aria-hidden /> {PROVIDER_NAMES[detected.provider]} video found ({detected.video_id}).
        </p>
      )}
      <TextField label="Video title" hint="Describes the video for screen readers and is shown on the play button." value={p.title} max={limit('video', 'title')} error={errors.title} onChange={(title) => patch(node, onChange, { title }, 'title')} />
      <ChoiceField
        label="Shape"
        value={p.aspect}
        error={errors.aspect}
        options={[
          { value: '16:9', label: 'Wide (16:9)' },
          { value: '4:3', label: 'Classic (4:3)' },
          { value: '1:1', label: 'Square (1:1)' },
          { value: '9:16', label: 'Tall, for Shorts (9:16)' },
        ]}
        onChange={(aspect) => patch(node, onChange, { aspect })}
      />
      <ToggleField label="Play without sound" hint="The video starts muted when a shopper clicks play." checked={p.autoplay} onChange={(autoplay) => patch(node, onChange, { autoplay })} />
      <PixelField label="Start at (seconds)" value={p.start} min={B4_BOUNDS.videoStart.min} max={B4_BOUNDS.videoStart.max} error={errors.start} hint="0 = from the beginning; 90 = from 1:30." onChange={(start) => patch(node, onChange, { start }, 'start')} />
      <p className="text-sm text-muted-foreground">The video loads only when a shopper clicks play, from YouTube’s privacy-enhanced player or Vimeo without tracking.</p>
      <Bangla {...props} fields={[{ name: 'title', label: 'Video title', base: p.title }]} />
    </div>
  )
}

/* ----------------------------------------------------------------------------------------------
 * Icon
 * -------------------------------------------------------------------------------------------- */

export function IconForm(props: B4FormProps<IconElement>) {
  const { node, onChange, errors, theme, icons = ICON_NAMES } = props
  const p = node.props
  return (
    <div className="flex flex-col gap-4">
      <IconPicker value={p.name} icons={icons} error={errors.name} onChange={(name) => patch(node, onChange, { name })} />
      <PixelField label="Size" value={p.size} min={B4_BOUNDS.iconSize.min} max={B4_BOUNDS.iconSize.max} error={errors.size} onChange={(size) => patch(node, onChange, { size }, 'size')} />
      <ColorControl label="Colour" value={p.color} onChange={(color) => patch(node, onChange, { color }, 'color')} themeColors={theme?.colors} palette={theme?.palette} allowTokens allowClear placeholder="Same as the text" />
      <FieldError message={errors.color} />
      <TextField label="Name for screen readers" hint="Leave empty when the icon is only decoration." value={p.label} max={limit('icon', 'label')} error={errors.label} onChange={(label) => patch(node, onChange, { label }, 'label')} />
      <LinkField key={node.id} label="Link" value={p.link?.url ?? null} error={errors.link} hint="Optional: the icon becomes a link." onChange={(url) => patch(node, onChange, { link: url === null ? null : { url } }, 'link')} />
      <Bangla {...props} fields={[{ name: 'label', label: 'Name for screen readers', base: p.label }]} />
    </div>
  )
}

/* ----------------------------------------------------------------------------------------------
 * Countdown and discount
 * -------------------------------------------------------------------------------------------- */

export function CountdownForm(props: B4FormProps<CountdownElement>) {
  const { node, onChange, errors } = props
  const p = node.props
  return (
    <div className="flex flex-col gap-4">
      <ChoiceField
        label="Count down to"
        value={p.source}
        error={errors.source}
        options={[
          { value: 'date', label: 'A date and time' },
          { value: 'promotion', label: 'The end of a sale' },
        ]}
        onChange={(source) => patch(node, onChange, { source })}
      />
      {p.source === 'date' ? (
        <ZonedDateTimeField label="Ends at" value={p.ends_at} error={errors.ends_at} onChange={(ends_at) => patch(node, onChange, { ends_at }, 'ends_at')} />
      ) : (
        <PromotionPicker kind="countdown" label="Sale" value={p.promotion_id} error={errors.promotion_id} onChange={(promotion_id) => patch(node, onChange, { promotion_id })} />
      )}
      <TextField label="Title" hint="Optional, e.g. “Eid sale ends in”." value={p.title} max={limit('countdown', 'title')} error={errors.title} onChange={(title) => patch(node, onChange, { title }, 'title')} />
      <TextField label="When the time is up" hint="Shown after the end. Leave empty to hide the countdown then." value={p.expired_text} max={limit('countdown', 'expired_text')} error={errors.expired_text} onChange={(expired_text) => patch(node, onChange, { expired_text }, 'expired_text')} />
      <ChoiceField
        label="Look"
        value={p.style}
        error={errors.style}
        options={[
          { value: 'boxes', label: 'Boxes (days, hours, minutes, seconds)' },
          { value: 'inline', label: 'One line of text' },
        ]}
        onChange={(style) => patch(node, onChange, { style })}
      />
      <Bangla
        {...props}
        fields={[
          { name: 'title', label: 'Title', base: p.title },
          { name: 'expired_text', label: 'When the time is up', base: p.expired_text },
        ]}
      />
    </div>
  )
}

export function DiscountForm(props: B4FormProps<DiscountElement>) {
  const { node, onChange, errors } = props
  const p = node.props
  return (
    <div className="flex flex-col gap-4">
      <PromotionPicker kind="discount" label="Promotion" value={p.promotion_id} error={errors.promotion_id} onChange={(promotion_id) => patch(node, onChange, { promotion_id })} />
      <ToggleField label="Show the coupon code" hint="With a copy button. Off: shoppers see the offer only." checked={p.show_code} onChange={(show_code) => patch(node, onChange, { show_code })} />
      <CouponPreview promotionId={p.promotion_id} show={p.show_code} />
      <TextField label="Title" hint="Optional; the promotion’s name is used when empty." value={p.title} max={limit('discount', 'title')} error={errors.title} onChange={(title) => patch(node, onChange, { title }, 'title')} />
      <TextField label="Text" multiline value={p.text} max={limit('discount', 'text')} error={errors.text} onChange={(text) => patch(node, onChange, { text }, 'text')} />
      <TextField label="Button text" hint="Leave empty for no button." value={p.button_label} max={limit('discount', 'button_label')} error={errors.button_label} onChange={(button_label) => patch(node, onChange, { button_label }, 'button_label')} />
      <LinkField key={node.id} label="Button opens" value={p.link?.url ?? null} error={errors.link} onChange={(url) => patch(node, onChange, { link: url === null ? null : { url } }, 'link')} />
      <p className="text-sm text-muted-foreground">When the promotion ends or is switched off, this element disappears from your store by itself.</p>
      <Bangla
        {...props}
        fields={[
          { name: 'title', label: 'Title', base: p.title },
          { name: 'text', label: 'Text', base: p.text, kind: 'textarea' },
          { name: 'button_label', label: 'Button text', base: p.button_label },
        ]}
      />
    </div>
  )
}

/* ----------------------------------------------------------------------------------------------
 * Call to action, search box, promoted product, newsletter form
 * -------------------------------------------------------------------------------------------- */

export function CtaForm(props: B4FormProps<CtaElement>) {
  const { node, onChange, errors } = props
  const p = node.props
  return (
    <div className="flex flex-col gap-4">
      <TextField label="Title" value={p.title} max={limit('cta', 'title')} error={errors.title} onChange={(title) => patch(node, onChange, { title }, 'title')} />
      <TextField label="Text" multiline value={p.text} max={limit('cta', 'text')} error={errors.text} onChange={(text) => patch(node, onChange, { text }, 'text')} />
      <fieldset className="flex flex-col gap-3 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">Main button</legend>
        <TextField label="Button text" value={p.primary.label} max={limit('cta', 'primary.label')} error={errors['primary.label']} onChange={(label) => patch(node, onChange, { primary: { ...p.primary, label } }, 'primary.label')} />
        <LinkField key={`${node.id}-primary`} required label="Opens" value={p.primary.link.url} error={errors['primary.link']} onChange={(url) => patch(node, onChange, { primary: { ...p.primary, link: { url: url ?? '' } } }, 'primary.link')} />
      </fieldset>
      <ToggleField
        label="Second button"
        checked={p.secondary !== null}
        onChange={(on) => patch(node, onChange, { secondary: on ? { label: 'Learn more', link: { url: '/' } } : null })}
      />
      {p.secondary && (
        <fieldset className="flex flex-col gap-3 rounded-md border p-3">
          <legend className="px-1 text-sm font-medium">Second button</legend>
          <TextField label="Second button text" value={p.secondary.label} max={limit('cta', 'secondary.label')} error={errors['secondary.label']} onChange={(label) => p.secondary && patch(node, onChange, { secondary: { ...p.secondary, label } }, 'secondary.label')} />
          <LinkField key={`${node.id}-secondary`} required label="Second button opens" value={p.secondary.link.url} error={errors['secondary.link']} onChange={(url) => p.secondary && patch(node, onChange, { secondary: { ...p.secondary, link: { url: url ?? '' } } }, 'secondary.link')} />
        </fieldset>
      )}
      <ChoiceField label="Alignment" value={p.align} error={errors.align} options={ALIGN_OPTIONS} onChange={(align) => patch(node, onChange, { align })} />
      <Bangla
        {...props}
        fields={[
          { name: 'title', label: 'Title', base: p.title },
          { name: 'text', label: 'Text', base: p.text, kind: 'textarea' },
          { name: 'primary.label', label: 'Button text', base: p.primary.label },
          ...(p.secondary ? [{ name: 'secondary.label', label: 'Second button text', base: p.secondary.label }] : []),
        ]}
      />
    </div>
  )
}

export function SearchBoxForm(props: B4FormProps<SearchBoxElement>) {
  const { node, onChange, errors } = props
  const p = node.props
  return (
    <div className="flex flex-col gap-4">
      <TextField label="Text in the empty box" value={p.placeholder} max={limit('search_box', 'placeholder')} error={errors.placeholder} onChange={(placeholder) => patch(node, onChange, { placeholder }, 'placeholder')} />
      <TextField label="Button text" hint="Leave empty to show only the magnifier icon." value={p.button_label} max={limit('search_box', 'button_label')} error={errors.button_label} onChange={(button_label) => patch(node, onChange, { button_label }, 'button_label')} />
      <p className="text-sm text-muted-foreground">Searching opens your shop’s search results.</p>
      <Bangla
        {...props}
        fields={[
          { name: 'placeholder', label: 'Text in the empty box', base: p.placeholder },
          { name: 'button_label', label: 'Button text', base: p.button_label },
        ]}
      />
    </div>
  )
}

export function PromoCardForm(props: B4FormProps<PromoCardElement>) {
  const { node, onChange, errors } = props
  const p = node.props
  return (
    <div className="flex flex-col gap-4">
      <SingleProductPicker value={p.product_id} error={errors.product_id} onChange={(product_id) => patch(node, onChange, { product_id })} />
      <TextField label="Badge" hint="A short label such as “New” or “Best seller”." value={p.badge} max={limit('promo_card', 'badge')} error={errors.badge} onChange={(badge) => patch(node, onChange, { badge }, 'badge')} />
      <TextField label="Title" hint="Leave empty to use the product’s name." value={p.title ?? ''} max={limit('promo_card', 'title')} error={errors.title} onChange={(title) => patch(node, onChange, { title: title === '' ? null : title }, 'title')} />
      <TextField label="Text" multiline value={p.text} max={limit('promo_card', 'text')} error={errors.text} onChange={(text) => patch(node, onChange, { text }, 'text')} />
      <TextField label="Button text" value={p.button_label} max={limit('promo_card', 'button_label')} error={errors.button_label} onChange={(button_label) => patch(node, onChange, { button_label }, 'button_label')} />
      <p className="text-sm text-muted-foreground">Price, picture and stock come from the product. If it stops being sold online, the card disappears from your store.</p>
      <Bangla
        {...props}
        fields={[
          { name: 'badge', label: 'Badge', base: p.badge },
          { name: 'title', label: 'Title', base: p.title ?? '' },
          { name: 'text', label: 'Text', base: p.text, kind: 'textarea' },
          { name: 'button_label', label: 'Button text', base: p.button_label },
        ]}
      />
    </div>
  )
}

export function NewsletterFormForm(props: B4FormProps<NewsletterFormElement>) {
  const { node, onChange, errors } = props
  const p = node.props
  return (
    <div className="flex flex-col gap-4">
      <TextField label="Title" value={p.title} max={limit('newsletter_form', 'title')} error={errors.title} onChange={(title) => patch(node, onChange, { title }, 'title')} />
      <TextField label="Text" multiline value={p.text} max={limit('newsletter_form', 'text')} error={errors.text} onChange={(text) => patch(node, onChange, { text }, 'text')} />
      <TextField label="Button text" value={p.button_label} max={limit('newsletter_form', 'button_label')} error={errors.button_label} onChange={(button_label) => patch(node, onChange, { button_label }, 'button_label')} />
      <ChoiceField label="Layout" value={p.layout} error={errors.layout} options={LAYOUT_OPTIONS} onChange={(layout) => patch(node, onChange, { layout })} />
      <p className="text-sm text-muted-foreground">
        Sign-ups are listed under <ManageLink to="/content/newsletter">Content → Newsletter</ManageLink>.
      </p>
      <Bangla
        {...props}
        fields={[
          { name: 'title', label: 'Title', base: p.title },
          { name: 'text', label: 'Text', base: p.text, kind: 'textarea' },
          { name: 'button_label', label: 'Button text', base: p.button_label },
        ]}
      />
    </div>
  )
}

/* ----------------------------------------------------------------------------------------------
 * CMS page elements
 * -------------------------------------------------------------------------------------------- */

export function FaqListForm(props: B4FormProps<FaqListElement>) {
  const { node, onChange, errors } = props
  const p = node.props
  return (
    <div className="flex flex-col gap-4">
      <TextField label="Title" hint="Optional, shown above the questions." value={p.title ?? ''} max={limit('faq_list', 'title')} error={errors.title} onChange={(title) => patch(node, onChange, { title: title === '' ? null : title }, 'title')} />
      <ChoiceField
        label="Look"
        value={p.style}
        error={errors.style}
        options={[
          { value: 'accordion', label: 'Click a question to open its answer' },
          { value: 'list', label: 'All answers shown' },
        ]}
        onChange={(style) => patch(node, onChange, { style })}
      />
      <p className="text-sm text-muted-foreground">
        The questions and answers come from <ManageLink to="/content/faq">Content → FAQ</ManageLink>.
      </p>
      <Bangla {...props} fields={[{ name: 'title', label: 'Title', base: p.title ?? '' }]} />
    </div>
  )
}

export function ContactFormForm(props: B4FormProps<ContactFormElement>) {
  const { node, onChange, errors } = props
  const p = node.props
  return (
    <div className="flex flex-col gap-4">
      <TextField label="Title" hint="Optional, shown above the form." value={p.title ?? ''} max={limit('contact_form', 'title')} error={errors.title} onChange={(title) => patch(node, onChange, { title: title === '' ? null : title }, 'title')} />
      <ToggleField label="Show your store’s contact details" hint="Phone, email and address next to the form." checked={p.show_details} onChange={(show_details) => patch(node, onChange, { show_details })} />
      <p className="text-sm text-muted-foreground">
        Messages arrive under <ManageLink to="/content/messages">Content → Messages</ManageLink>. Contact details are set on the <ManageLink to="/storefront/theme">Theme page</ManageLink>.
      </p>
      <Bangla {...props} fields={[{ name: 'title', label: 'Title', base: p.title ?? '' }]} />
    </div>
  )
}

/* ----------------------------------------------------------------------------------------------
 * Custom HTML
 * -------------------------------------------------------------------------------------------- */

export function CustomHtmlForm({ node, onChange, errors, canCustomHtml = false }: B4FormProps<CustomHtmlElement>) {
  const html = node.props.html
  if (!canCustomHtml) {
    return (
      <div className="flex flex-col gap-3" data-testid="custom-html-locked">
        <p className="flex gap-2 rounded-md border bg-muted/40 p-3 text-sm">
          <LockIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>Only people allowed to use custom HTML can change this. You can still move, hide or delete it.</span>
        </p>
        <FormField label="HTML (read only)">
          <Textarea readOnly rows={8} value={html} className="font-mono text-xs" />
        </FormField>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      <p role="note" className="flex gap-2 rounded-md border border-warning/50 bg-warning/10 p-3 text-sm text-warning-soft-foreground">
        <CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>Your HTML is cleaned when it is saved: scripts, embeds (iframes), style and link tags, event handlers, classes and ids are removed. Style it with the Style tab.</span>
      </p>
      <FormField label="HTML" error={errors.html} hint={counter(html, B4_BOUNDS.customHtml)}>
        <Textarea rows={12} spellCheck={false} maxLength={B4_BOUNDS.customHtml} value={html} className="font-mono text-xs" onChange={(e) => patch(node, onChange, { html: e.target.value }, 'html')} />
      </FormField>
    </div>
  )
}

/* ----------------------------------------------------------------------------------------------
 * Header and footer parts
 * -------------------------------------------------------------------------------------------- */

const ThemeNote = ({ children }: { children: string }) => (
  <p className="text-sm text-muted-foreground">
    {children} <ManageLink to="/storefront/theme">Theme page</ManageLink>.
  </p>
)

export function LogoForm({ node, onChange, errors }: B4FormProps<LogoElement>) {
  const p = node.props
  return (
    <div className="flex flex-col gap-4">
      <PixelField label="Height" value={p.height} min={B4_BOUNDS.logoHeight.min} max={B4_BOUNDS.logoHeight.max} error={errors.height} onChange={(height) => patch(node, onChange, { height }, 'height')} />
      <LinkField key={node.id} label="Link" value={p.link?.url ?? null} error={errors.link} hint="Usually your home page." onChange={(url) => patch(node, onChange, { link: url === null ? null : { url } }, 'link')} />
      <ThemeNote>The logo picture (or your store name when there is none) is set on the</ThemeNote>
    </div>
  )
}

export function MenuForm({ node, onChange, errors, context }: B4FormProps<MenuElement>) {
  const p = node.props
  const footer = context === 'footer'
  const childOptions = footer
    ? ([
        { value: 'none', label: 'Top level only' },
        { value: 'list', label: 'Sub-items listed below' },
      ] as const)
    : ([
        { value: 'none', label: 'Top level only' },
        { value: 'dropdown', label: 'Sub-items in a drop-down' },
        { value: 'mega', label: 'Large drop-down (mega menu)' },
      ] as const)
  const current = (childOptions as readonly { value: string }[]).some((o) => o.value === p.show_children) ? p.show_children : 'none'
  return (
    <div className="flex flex-col gap-4">
      <MenuPicker value={p.menu_id} error={errors.menu_id} onChange={(menu_id) => patch(node, onChange, { menu_id })} />
      <ChoiceField
        label="Direction"
        value={p.layout}
        error={errors.layout}
        options={[
          { value: 'horizontal', label: 'Side by side' },
          { value: 'vertical', label: 'One under the other' },
        ]}
        onChange={(layout) => patch(node, onChange, { layout })}
      />
      <ChoiceField label="Sub-items" value={current} error={errors.show_children} options={childOptions} onChange={(show_children) => patch(node, onChange, { show_children })} />
    </div>
  )
}

export function AccountLinkForm({ node, onChange }: B4FormProps<AccountLinkElement | WishlistLinkElement>) {
  const word = node.type === 'account_link' ? 'Account' : 'Wishlist'
  return (
    <div className="flex flex-col gap-4">
      <ToggleField label={`Show the word “${word}” next to the icon`} checked={node.props.show_label} onChange={(show_label) => patch(node, onChange, { show_label })} />
      <p className="text-sm text-muted-foreground">{node.type === 'account_link' ? 'Opens sign in, or the shopper’s account when signed in.' : 'Opens the shopper’s saved products.'}</p>
    </div>
  )
}

export function CartIconForm({ node, onChange }: B4FormProps<CartIconElement>) {
  return (
    <div className="flex flex-col gap-4">
      <ToggleField label="Show the number of items" checked={node.props.show_count} onChange={(show_count) => patch(node, onChange, { show_count })} />
      <ToggleField label="Show the cart total" checked={node.props.show_total} onChange={(show_total) => patch(node, onChange, { show_total })} />
      <p className="text-sm text-muted-foreground">Opens the shopper’s cart.</p>
    </div>
  )
}

export function LanguageSwitchForm({ node, onChange, errors }: B4FormProps<LanguageSwitchElement>) {
  return (
    <div className="flex flex-col gap-4">
      <ChoiceField
        label="Look"
        value={node.props.style}
        error={errors.style}
        options={[
          { value: 'links', label: 'English · বাংলা links' },
          { value: 'select', label: 'A drop-down list' },
        ]}
        onChange={(style) => patch(node, onChange, { style })}
      />
      <p className="text-sm text-muted-foreground">Shown only when your store has Bangla turned on.</p>
    </div>
  )
}

export function AnnouncementForm() {
  return (
    <div className="flex flex-col gap-3">
      <ThemeNote>The announcement text, link, colours and dates are set on the</ThemeNote>
      <p className="text-sm text-muted-foreground">Nothing shows while the announcement is off or outside its dates.</p>
    </div>
  )
}

export function SocialIconsForm({ node, onChange, errors, theme }: B4FormProps<SocialIconsElement>) {
  const p = node.props
  return (
    <div className="flex flex-col gap-4">
      <PixelField label="Size" value={p.size} min={B4_BOUNDS.socialSize.min} max={B4_BOUNDS.socialSize.max} error={errors.size} onChange={(size) => patch(node, onChange, { size }, 'size')} />
      <ChoiceField
        label="Shape"
        value={p.style}
        error={errors.style}
        options={[
          { value: 'plain', label: 'Icons only' },
          { value: 'circle', label: 'In circles' },
          { value: 'square', label: 'In squares' },
        ]}
        onChange={(style) => patch(node, onChange, { style })}
      />
      <ColorControl label="Colour" value={p.color} onChange={(color) => patch(node, onChange, { color }, 'color')} themeColors={theme?.colors} palette={theme?.palette} allowTokens allowClear placeholder="Same as the text" />
      <FieldError message={errors.color} />
      <ThemeNote>The links to your social pages are set on the</ThemeNote>
    </div>
  )
}

export function PaymentIconsForm({ node, onChange, errors }: B4FormProps<PaymentIconsElement>) {
  return (
    <div className="flex flex-col gap-4">
      <PixelField label="Height" value={node.props.height} min={B4_BOUNDS.paymentHeight.min} max={B4_BOUNDS.paymentHeight.max} error={errors.height} onChange={(height) => patch(node, onChange, { height }, 'height')} />
      <ThemeNote>The payment logos are chosen on the</ThemeNote>
    </div>
  )
}

export function ContactBlockForm({ node, onChange, errors }: B4FormProps<ContactBlockElement>) {
  const p = node.props
  return (
    <div className="flex flex-col gap-4">
      <ToggleField label="Phone" checked={p.show_phone} onChange={(show_phone) => patch(node, onChange, { show_phone })} />
      <ToggleField label="Email" checked={p.show_email} onChange={(show_email) => patch(node, onChange, { show_email })} />
      <ToggleField label="Address" checked={p.show_address} onChange={(show_address) => patch(node, onChange, { show_address })} />
      <ChoiceField label="Layout" value={p.layout} error={errors.layout} options={LAYOUT_OPTIONS} onChange={(layout) => patch(node, onChange, { layout })} />
      <ThemeNote>Your phone, email and address are set on the</ThemeNote>
    </div>
  )
}

export function CopyrightForm(props: B4FormProps<CopyrightElement>) {
  const { node, onChange, errors } = props
  const text = node.props.text
  return (
    <div className="flex flex-col gap-4">
      <TextField
        label="Copyright text"
        hint="Write {year} for the current year. Leave empty to use the copyright from the Theme page."
        placeholder="© {year} Your store"
        value={text ?? ''}
        max={limit('copyright', 'text')}
        error={errors.text}
        onChange={(value) => patch(node, onChange, { text: value === '' ? null : value }, 'text')}
      />
      <Bangla {...props} fields={[{ name: 'text', label: 'Copyright text', base: text ?? '' }]} />
    </div>
  )
}

/** The B4 form for a node, or null for other types. */
export function B4Form(props: B4FormProps<Element>) {
  const n = props.node as AnyB4
  const pass = <N,>() => props as unknown as B4FormProps<N>
  switch (n.type) {
    case 'video':
      return <VideoForm {...pass<VideoElement>()} />
    case 'icon':
      return <IconForm {...pass<IconElement>()} />
    case 'countdown':
      return <CountdownForm {...pass<CountdownElement>()} />
    case 'discount':
      return <DiscountForm {...pass<DiscountElement>()} />
    case 'cta':
      return <CtaForm {...pass<CtaElement>()} />
    case 'search_box':
      return <SearchBoxForm {...pass<SearchBoxElement>()} />
    case 'promo_card':
      return <PromoCardForm {...pass<PromoCardElement>()} />
    case 'newsletter_form':
      return <NewsletterFormForm {...pass<NewsletterFormElement>()} />
    case 'faq_list':
      return <FaqListForm {...pass<FaqListElement>()} />
    case 'contact_form':
      return <ContactFormForm {...pass<ContactFormElement>()} />
    case 'custom_html':
      return <CustomHtmlForm {...pass<CustomHtmlElement>()} />
    case 'logo':
      return <LogoForm {...pass<LogoElement>()} />
    case 'menu':
      return <MenuForm {...pass<MenuElement>()} />
    case 'account_link':
    case 'wishlist_link':
      return <AccountLinkForm {...pass<AccountLinkElement | WishlistLinkElement>()} />
    case 'cart_icon':
      return <CartIconForm {...pass<CartIconElement>()} />
    case 'language_switch':
      return <LanguageSwitchForm {...pass<LanguageSwitchElement>()} />
    case 'announcement':
      return <AnnouncementForm />
    case 'social_icons':
      return <SocialIconsForm {...pass<SocialIconsElement>()} />
    case 'payment_icons':
      return <PaymentIconsForm {...pass<PaymentIconsElement>()} />
    case 'contact_block':
      return <ContactBlockForm {...pass<ContactBlockElement>()} />
    case 'copyright':
      return <CopyrightForm {...pass<CopyrightElement>()} />
    default:
      return null
  }
}
