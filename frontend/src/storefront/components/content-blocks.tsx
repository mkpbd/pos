import { MailIcon, MapPinIcon, PhoneIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useStorefront } from '../api'
import { useLocale } from '../i18n/locale'
import type { FaqGroup } from '../types'
import { RichText } from './rich-text'

/*
 * Blocks of the content pages (/pages/:slug), shared with the store builder's FAQ list and contact
 * form elements: the FAQ (accordion of <details>, or a plain list) and the store's contact details.
 */

/** FAQ items by group. `accordion` (the FAQ page): each question opens its answer; `list`: every answer shown. */
export function FaqGroups({ groups, style = 'accordion', className, headingLevel = 2 }: { groups: FaqGroup[]; style?: 'accordion' | 'list'; className?: string; headingLevel?: 2 | 3 }) {
  const { t } = useLocale()
  if (groups.length === 0) return null
  const GroupHeading = `h${headingLevel}` as const
  const QuestionHeading = `h${headingLevel + 1}` as 'h3' | 'h4'

  return (
    <div className={cn('flex flex-col gap-8', className)} data-testid="faq-groups">
      {groups.map((g) => (
        <section key={g.group ?? ''} aria-label={g.group ?? t('content.page.questions')}>
          {g.group && <GroupHeading className="mb-3 text-2xl font-bold">{g.group}</GroupHeading>}
          {style === 'accordion' ? (
            <div className="divide-y rounded-sf-card bg-sf-surface">
              {g.items.map((item) => (
                <details key={item.id} className="group px-5 py-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold text-sf-heading">
                    {item.question}
                    <span aria-hidden className="text-xl transition-transform group-open:rotate-45">+</span>
                  </summary>
                  <RichText html={item.answer_html} className="pt-3" />
                </details>
              ))}
            </div>
          ) : (
            <dl className="flex flex-col gap-5">
              {g.items.map((item) => (
                <div key={item.id}>
                  <dt>
                    <QuestionHeading className="text-lg font-bold text-sf-heading">{item.question}</QuestionHeading>
                  </dt>
                  <dd>
                    <RichText html={item.answer_html} className="pt-1" />
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      ))}
    </div>
  )
}

/** The store's address, phone and e-mail from the theme footer (nothing when none is set). */
export function ContactDetails({ className }: { className?: string }) {
  const { contact } = useStorefront().theme.footer
  if (!contact.email && !contact.phone && !contact.address) return null

  return (
    <ul className={cn('flex flex-col gap-3 rounded-sf-card bg-sf-surface p-6', className)} data-testid="contact-details">
      {contact.address && <li className="flex gap-3"><MapPinIcon className="size-5 shrink-0 text-sf-accent" aria-hidden /><span className="whitespace-pre-line">{contact.address}</span></li>}
      {contact.phone && <li className="flex gap-3"><PhoneIcon className="size-5 shrink-0 text-sf-accent" aria-hidden /><a href={`tel:${contact.phone}`} className="hover:underline">{contact.phone}</a></li>}
      {contact.email && <li className="flex gap-3"><MailIcon className="size-5 shrink-0 text-sf-accent" aria-hidden /><a href={`mailto:${contact.email}`} className="hover:underline">{contact.email}</a></li>}
    </ul>
  )
}
