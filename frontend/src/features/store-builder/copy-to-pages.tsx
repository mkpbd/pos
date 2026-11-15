import { useId, useMemo, useState } from 'react'
import { CircleAlertIcon, CircleCheckIcon, Loader2Icon } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ApiError } from '@/lib/api/client'
import type { DocumentSection } from '@/storefront/builder/types'
import { builderAdminKeys, useDocumentsQuery, type DocumentSummary } from './api'
import { COPY_LIMIT, copySectionToPages, copyTargets, type CopyPosition, type CopyResult } from './copy-to-pages-api'
import { globalKeys } from './global-api'

/*
 * B12 "Copy to other pages…" (a section's ⋯ menu): the owner picks pages (and page zones) and
 * top or bottom; the server appends the section to each page's DRAFT (new ids, never published)
 * and answers per page. The open document is never offered (copying into it would clash with this
 * editor's next save); popups, globals, the header and the footer aren't targets.
 */

function where(doc: DocumentSummary): string {
  if (doc.kind === 'zone') return 'Part of shop pages'
  return doc.path ?? (doc.cms_page ? `/pages/${doc.cms_page.slug}` : '')
}

export function CopyToPagesDialog({ section, openId, onClose }: { section: DocumentSection | null; openId: string; onClose: () => void }) {
  const open = section !== null
  const documents = useDocumentsQuery()
  const queryClient = useQueryClient()
  const targets = useMemo(() => copyTargets(documents.data ?? [], openId), [documents.data, openId])
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [position, setPosition] = useState<CopyPosition>('bottom')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<CopyResult[] | null>(null)
  const [seen, setSeen] = useState<DocumentSection | null>(null)
  const ids = useId()
  if (section !== seen) {
    setSeen(section)
    setSearch('')
    setPicked([])
    setPosition('bottom')
    setError(null)
    setResults(null)
  }
  const shown = targets.filter((d) => d.title.toLowerCase().includes(search.trim().toLowerCase()))
  const full = picked.length >= COPY_LIMIT

  const toggle = (id: string, on: boolean) => setPicked((list) => (on ? (list.includes(id) || list.length >= COPY_LIMIT ? list : [...list, id]) : list.filter((x) => x !== id)))

  const submit = async () => {
    if (!section || picked.length === 0) return
    setPending(true)
    setError(null)
    try {
      const answer = await copySectionToPages(section, picked, position)
      setResults(answer)
      void queryClient.invalidateQueries({ queryKey: builderAdminKeys.documents })
      void queryClient.invalidateQueries({ queryKey: globalKeys.list })
      for (const r of answer) if (r.status === 'copied') void queryClient.invalidateQueries({ queryKey: builderAdminKeys.document(r.document_id) })
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === 'CUSTOM_HTML_FORBIDDEN'
          ? 'This section holds custom HTML, and only people allowed to use custom HTML can copy it.'
          : e instanceof Error
            ? e.message
            : 'It couldn’t be copied. Try again.',
      )
    } finally {
      setPending(false)
    }
  }

  const copied = results?.filter((r) => r.status === 'copied').length ?? 0
  const titleOf = (r: CopyResult) => r.title ?? targets.find((d) => d.id === r.document_id)?.title ?? 'A page'

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent className="sm:max-w-lg" data-testid="copy-to-pages">
        <DialogHeader>
          <DialogTitle>Copy this section to other pages</DialogTitle>
          <DialogDescription>A copy goes into each page’s draft. Nothing changes on your shop until you publish those pages.</DialogDescription>
        </DialogHeader>

        {results ? (
          <div className="flex flex-col gap-2">
            <p role="status" className="text-sm font-medium">
              {copied === results.length ? `Copied to ${copied} ${copied === 1 ? 'page' : 'pages'}.` : `Copied to ${copied} of ${results.length} pages.`} Open a page and publish it to show the section to shoppers.
            </p>
            <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto text-sm" aria-label="What happened on each page">
              {results.map((r) => (
                <li key={r.document_id} className="flex items-start gap-2">
                  {r.status === 'copied' ? <CircleCheckIcon className="mt-0.5 size-4 shrink-0 text-green-600" aria-hidden /> : <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />}
                  <span>
                    <span className="font-medium">{titleOf(r)}</span>
                    {r.status === 'copied' ? ' — copied' : ` — not copied: ${r.error?.message ?? 'something went wrong.'}`}
                  </span>
                </li>
              ))}
            </ul>
            <DialogFooter>
              <Button type="button" onClick={onClose}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
          >
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Pages</legend>
              <Input type="search" aria-label="Find a page" placeholder="Find a page" value={search} onChange={(e) => setSearch(e.target.value)} />
              <div className="max-h-64 overflow-y-auto rounded-md border p-1" data-testid="copy-targets">
                {documents.isLoading && <p className="p-2 text-sm text-muted-foreground">Loading your pages…</p>}
                {!documents.isLoading && targets.length === 0 && <p className="p-2 text-sm text-muted-foreground">There are no other pages to copy it to yet.</p>}
                {!documents.isLoading && targets.length > 0 && shown.length === 0 && <p className="p-2 text-sm text-muted-foreground">No page matches “{search}”.</p>}
                {shown.map((doc) => {
                  const id = `${ids}-${doc.id}`
                  const checked = picked.includes(doc.id)
                  return (
                    <div key={doc.id} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted">
                      <Checkbox id={id} checked={checked} disabled={!checked && full} onCheckedChange={(value) => toggle(doc.id, value === true)} />
                      <label htmlFor={id} className="flex min-w-0 flex-1 flex-col text-sm">
                        <span className="truncate">{doc.title}</span>
                        <span className="truncate text-xs text-muted-foreground">{where(doc)}</span>
                      </label>
                    </div>
                  )
                })}
              </div>
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {picked.length} picked{full ? ` — up to ${COPY_LIMIT} pages at a time` : ''}
              </p>
            </fieldset>
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 text-sm font-medium">Where on each page</legend>
              {(['top', 'bottom'] as const).map((value) => (
                <label key={value} className="flex items-center gap-2 text-sm">
                  <input type="radio" name={`${ids}-position`} value={value} checked={position === value} onChange={() => setPosition(value)} className="size-4 accent-primary" />
                  {value === 'top' ? 'At the top' : 'At the bottom'}
                </label>
              ))}
            </fieldset>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || picked.length === 0}>
                {pending && <Loader2Icon className="animate-spin motion-reduce:animate-none" data-icon="inline-start" />}
                {picked.length > 1 ? `Copy to ${picked.length} pages` : 'Copy'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
