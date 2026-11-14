import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { PlusIcon } from 'lucide-react'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCan } from '@/features/auth/use-auth'
import { useShortLinksQuery } from '@/features/marketing/api'
import { MarketingHeader } from '@/features/marketing/components/marketing-header'
import { ShortLinkDialog } from '@/features/marketing/components/short-link-dialog'
import { ShortLinksTable } from '@/features/marketing/components/short-links-table'
import { useDebouncedValue } from '@/lib/use-debounced-value'

/** /marketing/short-links — every short link with its clicks; copy, QR code, edit and delete. */
export function ShortLinksPage() {
  const canManage = useCan()('marketing.manage')
  const [searchParams, setSearchParams] = useSearchParams()
  const page = Math.max(1, Number(searchParams.get('page')) || 1)
  const [search, setSearch] = useState('')
  const term = useDebouncedValue(search.trim())
  const links = useShortLinksQuery({ page, ...(term ? { search: term } : {}) })
  const [creating, setCreating] = useState(false)

  const setPage = (p: number) => {
    const next = new URLSearchParams(searchParams)
    if (p === 1) next.delete('page')
    else next.set('page', String(p))
    setSearchParams(next, { replace: true })
  }
  const rows = links.data?.items ?? []

  return (
    <div className="flex flex-col gap-6">
      <MarketingHeader actions={canManage && <Button onClick={() => setCreating(true)}><PlusIcon data-icon="inline-start" /> New short link</Button>} />
      <p className="-mt-2 text-sm text-muted-foreground">
        A short link like <span className="font-mono">yourshop.com/go/eid</span> opens a page of your store and tells you which ad or post the visitor came from.
      </p>

      <Input
        aria-label="Search short links"
        placeholder="Search by code or page"
        className="w-full sm:max-w-xs"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value)
          if (page !== 1) setPage(1)
        }}
      />

      {links.isPending ? (
        <LoadingState rows={4} label="Loading short links" />
      ) : links.error ? (
        <ErrorState error={links.error} onRetry={() => void links.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={term ? 'No short links match your search' : 'No short links yet'}
          description={term ? undefined : 'Make one for each ad or post, then paste it into Facebook, a message or print its QR code.'}
          action={!term && canManage ? <Button onClick={() => setCreating(true)}><PlusIcon data-icon="inline-start" /> New short link</Button> : undefined}
        />
      ) : (
        <>
          <ShortLinksTable links={rows} />
          <PaginationBar pagination={links.data.pagination} onPageChange={setPage} />
        </>
      )}

      {creating && <ShortLinkDialog link={null} onClose={() => setCreating(false)} />}
    </div>
  )
}
