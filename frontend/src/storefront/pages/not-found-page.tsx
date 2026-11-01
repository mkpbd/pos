import { Link } from 'react-router'
import { useDocumentMeta } from '../use-document-meta'

export function NotFoundPage() {
  useDocumentMeta({ title: 'Page not found', noindex: true })

  return (
    <section className="mx-auto max-w-sf px-4 py-20 text-center">
      <p className="font-heading text-7xl font-extrabold text-sf-accent">404</p>
      <h1 className="mt-2 text-3xl font-bold">Page not found</h1>
      <p className="mx-auto mt-3 max-w-md">The page you are looking for does not exist or has moved.</p>
      <Link
        to="/"
        className="mt-8 inline-flex items-center rounded-sf-button bg-sf-primary px-6 py-3 text-sm font-bold tracking-wide text-sf-primary-foreground uppercase transition-opacity hover:opacity-90"
      >
        Back to the home page
      </Link>
    </section>
  )
}
