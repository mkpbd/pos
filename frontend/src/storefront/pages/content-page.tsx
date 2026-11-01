import { Link, useParams } from 'react-router'
import { MailIcon, MapPinIcon, PhoneIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api/client'
import { useStorefront, useStorePageQuery } from '../api'
import { ContactForm } from '../components/contact-form'
import { RichText } from '../components/rich-text'
import type { FaqGroup } from '../types'
import { useDocumentMeta } from '../use-document-meta'
import { NotFoundPage } from './not-found-page'

function PageTitle({ title }: { title: string }) {
  return (
    <div className="bg-sf-surface">
      <div className="mx-auto max-w-sf px-4 py-10 text-center">
        <h1 className="text-3xl font-extrabold lg:text-4xl">{title}</h1>
        <nav aria-label="Breadcrumb" className="mt-2 text-sm">
          <ol className="flex justify-center gap-2">
            <li><Link to="/" className="hover:underline">Home</Link></li>
            <li aria-hidden>/</li>
            <li aria-current="page">{title}</li>
          </ol>
        </nav>
      </div>
    </div>
  )
}

function Faq({ groups }: { groups: FaqGroup[] }) {
  if (groups.length === 0) return null

  return (
    <div className="mt-10 flex flex-col gap-8">
      {groups.map((g) => (
        <section key={g.group ?? ''} aria-label={g.group ?? 'Questions'}>
          {g.group && <h2 className="mb-3 text-2xl font-bold">{g.group}</h2>}
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
        </section>
      ))}
    </div>
  )
}

function ContactDetails() {
  const { contact } = useStorefront().theme.footer
  if (!contact.email && !contact.phone && !contact.address) return null

  return (
    <ul className="flex flex-col gap-3 rounded-sf-card bg-sf-surface p-6">
      {contact.address && <li className="flex gap-3"><MapPinIcon className="size-5 shrink-0 text-sf-accent" aria-hidden /><span className="whitespace-pre-line">{contact.address}</span></li>}
      {contact.phone && <li className="flex gap-3"><PhoneIcon className="size-5 shrink-0 text-sf-accent" aria-hidden /><a href={`tel:${contact.phone}`} className="hover:underline">{contact.phone}</a></li>}
      {contact.email && <li className="flex gap-3"><MailIcon className="size-5 shrink-0 text-sf-accent" aria-hidden /><a href={`mailto:${contact.email}`} className="hover:underline">{contact.email}</a></li>}
    </ul>
  )
}

/** A content page (/pages/:slug) in its layout: standard, FAQ or contact. */
export function ContentPage() {
  const { slug = '' } = useParams()
  const page = useStorePageQuery(slug)
  useDocumentMeta(page.data ? { title: page.data.seo_title ?? page.data.title, description: page.data.seo_description, canonical: `/pages/${page.data.slug}` } : null)

  if (page.isPending) {
    return (
      <div role="status" className="grid min-h-[50vh] place-items-center">
        <span className="size-10 animate-spin rounded-full border-4 border-sf-border border-t-sf-accent" aria-hidden />
        <span className="sr-only">Loading</span>
      </div>
    )
  }
  if (page.error instanceof ApiError && page.error.status === 404) return <NotFoundPage />
  if (page.error) {
    return (
      <section className="mx-auto max-w-sf px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">This page could not be loaded</h1>
        <Button className="mt-4 rounded-sf-button" onClick={() => void page.refetch()}>Try again</Button>
      </section>
    )
  }

  const data = page.data
  return (
    <article>
      <PageTitle title={data.title} />
      <div className="mx-auto max-w-sf px-4 py-12">
        {data.template === 'contact' ? (
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <div className="flex flex-col gap-6">
              {data.body_html && <RichText html={data.body_html} />}
              <ContactDetails />
            </div>
            <ContactForm />
          </div>
        ) : (
          <div className="mx-auto max-w-3xl">
            {data.body_html && <RichText html={data.body_html} />}
            {data.template === 'faq' && <Faq groups={data.faq ?? []} />}
          </div>
        )}
      </div>
    </article>
  )
}
