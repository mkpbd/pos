import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { ArchiveIcon, ArchiveRestoreIcon, ArrowLeftIcon, Link2Icon, PencilIcon, PlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useCan } from '@/features/auth/use-auth'
import {
  useCampaignQuery,
  useCampaignsQuery,
  useMarketingStatsQuery,
  useSaveCampaignMutation,
  useShortLinksQuery,
  type Campaign,
  type CampaignRow,
  type CampaignStatus,
  type MarketingStats,
} from '@/features/marketing/api'
import { CampaignDialog } from '@/features/marketing/components/campaign-dialog'
import { MarketingHeader } from '@/features/marketing/components/marketing-header'
import { useStatsRange } from '@/features/marketing/components/use-stats-range'
import { ShortLinkDialog } from '@/features/marketing/components/short-link-dialog'
import { ShortLinksTable } from '@/features/marketing/components/short-links-table'
import { DayChart, LandingPagesCard, SourcesCard, StatTiles } from '@/features/marketing/components/stats-views'
import { CAMPAIGN_STATUS, campaignDates, formatCount, formatPercent } from '@/features/marketing/marketing'
import { formatMoney } from '@/lib/money'
import { useDebouncedValue } from '@/lib/use-debounced-value'

function useArchive() {
  const save = useSaveCampaignMutation()
  const toggle = (c: Campaign) => {
    const status: CampaignStatus = c.status === 'active' ? 'archived' : 'active'
    save.mutate(
      { id: c.id, input: { status } },
      {
        onSuccess: (saved) => toast.success(saved.status === 'archived' ? `${saved.name} archived. Its links keep working and its figures stay.` : `${saved.name} is active again.`),
        onError: (e) => toast.error(e.message),
      },
    )
  }
  return { toggle, pending: save.isPending }
}

/** Every campaign's results side by side; orders without a campaign show as "Direct / other". */
function ByCampaignCard({ stats }: { stats: MarketingStats }) {
  const rows = stats.by_campaign
  const money = (v: string | null) => (v === null ? '—' : formatMoney(v))
  const name = (r: CampaignRow) =>
    r.campaign ? (
      <Link to={`/marketing/campaigns/${r.campaign.id}`} className="font-medium underline-offset-4 hover:underline">{r.campaign.name}</Link>
    ) : (
      <span className="text-muted-foreground">Direct / other</span>
    )

  return (
    <Card>
      <CardHeader>
        <CardTitle><h2>Results by campaign</h2></CardTitle>
        <CardDescription>
          Revenue in {stats.currency ?? 'your currency'}, cancelled orders left out. “Direct / other” is everything that did not come through a campaign link or page.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No visits or orders in this period.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table aria-label="Results by campaign">
              <TableHeader>
                <TableRow>
                  <TableHead>Campaign</TableHead>
                  <TableHead className="text-right">Visits</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Conversion</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Average order</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.campaign?.id ?? 'direct'}>
                    <TableCell>
                      {name(r)}
                      {r.campaign?.status === 'archived' && <Badge variant="outline" className="ml-2">Archived</Badge>}
                    </TableCell>
                    <TableCell className="text-right font-mono">{formatCount(r.visits)}</TableCell>
                    <TableCell className="text-right font-mono">{formatCount(r.orders)}</TableCell>
                    <TableCell className="text-right font-mono whitespace-nowrap">{formatMoney(r.revenue)}</TableCell>
                    <TableCell className="hidden text-right font-mono sm:table-cell">{formatPercent(r.conversion_rate)}</TableCell>
                    <TableCell className="hidden text-right font-mono whitespace-nowrap md:table-cell">{money(r.average_order_value)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ResultsSection() {
  const { range, filter } = useStatsRange()
  const stats = useMarketingStatsQuery(range)

  return (
    <section aria-labelledby="results-title" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="results-title" className="font-heading text-lg font-semibold">Results</h2>
        <p className="text-sm text-muted-foreground">Visits are counted for campaign links and campaign pages; orders include every web order.</p>
      </div>
      {filter}
      {stats.isPending ? (
        <LoadingState rows={3} label="Loading results" />
      ) : stats.error ? (
        <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />
      ) : (
        <>
          <StatTiles stats={stats.data} />
          <ByCampaignCard stats={stats.data} />
        </>
      )}
    </section>
  )
}

/** /marketing/campaigns — results of the period and the list of campaigns. */
export function CampaignsPage() {
  const canManage = useCan()('marketing.manage')
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const status: CampaignStatus = searchParams.get('status') === 'archived' ? 'archived' : 'active'
  const page = Math.max(1, Number(searchParams.get('page')) || 1)
  const [search, setSearch] = useState('')
  const term = useDebouncedValue(search.trim())
  const campaigns = useCampaignsQuery({ page, status, ...(term ? { search: term } : {}) })
  const archive = useArchive()
  const [editing, setEditing] = useState<Campaign | 'new' | null>(null)

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams)
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) next.delete(k)
      else next.set(k, v)
    }
    setSearchParams(next, { replace: true })
  }
  const rows = campaigns.data?.items ?? []

  return (
    <div className="flex flex-col gap-6">
      <MarketingHeader actions={canManage && <Button onClick={() => setEditing('new')}><PlusIcon data-icon="inline-start" /> New campaign</Button>} />

      <ResultsSection />

      <section aria-labelledby="campaigns-title" className="flex flex-col gap-4">
        <h2 id="campaigns-title" className="font-heading text-lg font-semibold">Campaigns</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Tabs value={status} onValueChange={(v) => update({ status: v === 'active' ? null : v, page: null })}>
            <TabsList aria-label="Campaign status">
              <TabsTrigger value="active">Active</TabsTrigger>
              <TabsTrigger value="archived">Archived</TabsTrigger>
            </TabsList>
          </Tabs>
          <Input
            aria-label="Search campaigns"
            placeholder="Search by name or tag"
            className="w-full sm:max-w-xs"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              if (page !== 1) update({ page: null })
            }}
          />
        </div>

        {campaigns.isPending ? (
          <LoadingState rows={4} label="Loading campaigns" />
        ) : campaigns.error ? (
          <ErrorState error={campaigns.error} onRetry={() => void campaigns.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={term ? 'No campaigns match your search' : status === 'archived' ? 'No archived campaigns' : 'No campaigns yet'}
            description={term || status === 'archived' ? undefined : 'Make one for each promotion — an Eid sale, a new arrival, a Facebook ad — to see the visits and orders it brings.'}
            action={!term && status === 'active' && canManage ? <Button onClick={() => setEditing('new')}><PlusIcon data-icon="inline-start" /> New campaign</Button> : undefined}
          />
        ) : (
          <>
            <div className="overflow-x-auto rounded-md border">
              <Table aria-label="Campaigns">
                <TableHeader>
                  <TableRow>
                    <TableHead>Campaign</TableHead>
                    <TableHead className="hidden md:table-cell">Campaign page</TableHead>
                    <TableHead className="hidden sm:table-cell">Dates</TableHead>
                    <TableHead className="hidden text-right lg:table-cell">Short links</TableHead>
                    <TableHead className="w-0"><span className="sr-only">Actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <Link to={`/marketing/campaigns/${c.id}`} className="font-medium underline-offset-4 hover:underline">{c.name}</Link>
                        <div className="font-mono text-xs text-muted-foreground">{c.utm_campaign}</div>
                      </TableCell>
                      <TableCell className="hidden text-sm md:table-cell">
                        {c.landing_document ? (
                          <>
                            {c.landing_document.title}
                            <div className="font-mono text-xs text-muted-foreground">{c.landing_document.path}{!c.landing_document.published && ' · not published'}</div>
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden text-sm whitespace-nowrap sm:table-cell">{campaignDates(c)}</TableCell>
                      <TableCell className="hidden text-right font-mono lg:table-cell">{formatCount(c.short_links_count ?? 0)}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button variant="outline" size="sm" onClick={() => navigate(`/marketing/campaigns/${c.id}`)}>Results</Button>
                          {canManage && (
                            <>
                              <Button variant="ghost" size="icon-sm" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)}><PencilIcon /></Button>
                              <Button variant="ghost" size="icon-sm" aria-label={c.status === 'active' ? `Archive ${c.name}` : `Restore ${c.name}`} disabled={archive.pending} onClick={() => archive.toggle(c)}>
                                {c.status === 'active' ? <ArchiveIcon /> : <ArchiveRestoreIcon />}
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <PaginationBar pagination={campaigns.data.pagination} onPageChange={(p) => update({ page: p === 1 ? null : String(p) })} />
          </>
        )}
      </section>

      {editing && (
        <CampaignDialog
          key={editing === 'new' ? 'new' : editing.id}
          campaign={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => editing === 'new' && navigate(`/marketing/campaigns/${saved.id}`)}
        />
      )}
    </div>
  )
}

/** /marketing/campaigns/:campaignId — one campaign's results, by day, source and page, and its short links. */
export function CampaignPage() {
  const { campaignId } = useParams()
  const canManage = useCan()('marketing.manage')
  const campaign = useCampaignQuery(campaignId)
  const { range, filter } = useStatsRange()
  const stats = useMarketingStatsQuery({ ...range, campaign_id: campaignId ?? '' }, { enabled: !!campaignId })
  const links = useShortLinksQuery({ page: 1, per_page: 100, campaign_id: campaignId })
  const archive = useArchive()
  const [editing, setEditing] = useState(false)
  const [newLink, setNewLink] = useState(false)

  if (campaign.isPending) return <LoadingState rows={6} label="Loading campaign" />
  if (campaign.error) return <ErrorState error={campaign.error} onRetry={() => void campaign.refetch()} />
  const c = campaign.data
  const badge = CAMPAIGN_STATUS[c.status] ?? { label: c.status, variant: 'outline' as const }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="ghost" size="icon" aria-label="Back to campaigns"><Link to="/marketing/campaigns"><ArrowLeftIcon /></Link></Button>
            <h1 className="font-heading text-2xl font-semibold tracking-tight">{c.name}</h1>
            <Badge variant={badge.variant}>{badge.label}</Badge>
          </div>
          <dl className="flex flex-wrap gap-x-6 gap-y-1 pl-10 text-sm">
            <div className="flex gap-1.5"><dt className="text-muted-foreground">Link tag</dt><dd className="font-mono">{c.utm_campaign}</dd></div>
            <div className="flex gap-1.5">
              <dt className="text-muted-foreground">Campaign page</dt>
              <dd>{c.landing_document ? <><span className="font-mono">{c.landing_document.path}</span>{!c.landing_document.published && <span className="text-muted-foreground"> (not published)</span>}</> : '—'}</dd>
            </div>
            <div className="flex gap-1.5"><dt className="text-muted-foreground">Dates</dt><dd>{campaignDates(c)}</dd></div>
          </dl>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setEditing(true)}><PencilIcon data-icon="inline-start" /> Edit</Button>
            <Button variant="outline" disabled={archive.pending} onClick={() => archive.toggle(c)}>
              {c.status === 'active' ? <><ArchiveIcon data-icon="inline-start" /> Archive</> : <><ArchiveRestoreIcon data-icon="inline-start" /> Restore</>}
            </Button>
          </div>
        )}
      </div>

      {filter}

      {stats.isPending ? (
        <LoadingState rows={4} label="Loading results" />
      ) : stats.error ? (
        <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />
      ) : (
        <>
          <StatTiles stats={stats.data} />
          <DayChart days={stats.data.by_day} currency={stats.data.currency} />
          <div className="grid gap-6 lg:grid-cols-2">
            <SourcesCard rows={stats.data.by_source} />
            <LandingPagesCard rows={stats.data.top_landing_pages} />
          </div>
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle><h2>Short links</h2></CardTitle>
          <CardDescription>Put a different link in each ad or post to see which one works best.</CardDescription>
          {canManage && (
            <CardAction><Button size="sm" onClick={() => setNewLink(true)}><Link2Icon data-icon="inline-start" /> New short link</Button></CardAction>
          )}
        </CardHeader>
        <CardContent>
          {links.isPending ? (
            <LoadingState rows={2} label="Loading short links" />
          ) : links.error ? (
            <ErrorState error={links.error} onRetry={() => void links.refetch()} />
          ) : links.data.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No short links for this campaign yet.</p>
          ) : (
            <ShortLinksTable links={links.data.items} showCampaign={false} />
          )}
        </CardContent>
      </Card>

      {editing && <CampaignDialog key={c.id} campaign={c} onClose={() => setEditing(false)} />}
      {newLink && <ShortLinkDialog link={null} campaignId={c.id} defaultTarget={c.landing_document?.path ?? ''} onClose={() => setNewLink(false)} />}
    </div>
  )
}
