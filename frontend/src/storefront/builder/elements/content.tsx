import { useContext } from 'react'
import { cn } from '@/lib/utils'
import { useStorefront } from '../../api'
import { ContactDetails, FaqGroups } from '../../components/content-blocks'
import { ContactForm } from '../../components/contact-form'
import { isMarkState, useElementData, usePage } from '../render-context'
import { DraftPlaceholder, PreviewMark } from '../preview-mark'
import { B4_ENUMS, oneOf } from '../validate'
import { FaqFallbackCtx } from './faq-fallback'
import { isFaqListData } from './guards'
import type { El } from './shared'

/*
 * CMS-page elements: the FAQ list (the FAQ page's accordion) and the contact form (the contact
 * page's form and store details). Both keep working exactly like the classic pages.
 */

export function FaqListElement({ element }: { element: El<'faq_list'> }) {
  const { draft } = usePage()
  const fallback = useContext(FaqFallbackCtx)
  const data = useElementData(element.id)
  const resolved = data && isFaqListData(data) ? data : null
  const groups = resolved ? resolved.groups : (fallback ?? [])
  const state = resolved && isMarkState(resolved.state) ? resolved.state : null
  if (state && !draft) return null
  if (groups.every((group) => !Array.isArray(group.items) || group.items.length === 0)) return <DraftPlaceholder element={element} />
  const title = typeof element.props?.title === 'string' ? element.props.title.trim() : ''
  const style = oneOf(element.props?.style, B4_ENUMS.faqStyle) ?? 'accordion'

  return (
    <PreviewMark state={state}>
      <div data-b={element.id} className="b-faq" data-testid="builder-faq">
        {title && <h2 className="mb-6 text-3xl font-extrabold">{title}</h2>}
        <FaqGroups groups={groups} style={style} headingLevel={title ? 3 : 2} />
      </div>
    </PreviewMark>
  )
}

/** The store's contact form (messages land in the admin), with the store's contact details beside it. */
export function ContactFormElement({ element }: { element: El<'contact_form'> }) {
  const title = typeof element.props?.title === 'string' ? element.props.title.trim() : ''
  const { contact } = useStorefront().theme.footer
  const details = element.props?.show_details !== false && Boolean(contact.email || contact.phone || contact.address)
  return (
    <div data-b={element.id} className="b-contact-form" data-testid="builder-contact-form">
      {title && <h2 className="mb-6 text-3xl font-extrabold">{title}</h2>}
      <div className={cn('grid gap-8', details && 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]')}>
        {details && <ContactDetails className="self-start" />}
        <ContactForm />
      </div>
    </div>
  )
}
