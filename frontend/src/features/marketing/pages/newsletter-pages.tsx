import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowLeftIcon, Loader2Icon, PlusIcon, SendIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { FormField } from '@/components/common/form-field'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { SafeMarkdown } from '@/features/ai/components/safe-markdown'
import {
  useDeleteNewsletterCampaignMutation,
  useNewsletterCampaignQuery,
  useNewsletterCampaignsQuery,
  useSaveNewsletterCampaignMutation,
  useSendNewsletterCampaignMutation,
  useSubscriberSummaryQuery,
  useTestNewsletterCampaignMutation,
  type CampaignStatus,
  type NewsletterCampaign,
} from '@/features/content/api'
import { MarketingHeader } from '@/features/marketing/components/marketing-header'
import { fieldErrorMap } from '@/lib/forms'

/** BD2b: newsletter e-mails to confirmed subscribers (cms.manage, like the subscriber list). */

const STATUS: Record<CampaignStatus, { label: string; variant: 'outline' | 'warning' | 'success' }> = {
  draft: { label: 'Draft', variant: 'outline' },
  sending: { label: 'Sending', variant: 'warning' },
  sent: { label: 'Sent', variant: 'success' },
}
const MAX_SUBJECT = 150
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '—')

function SubscriberSummaryLine() {
  const summary = useSubscriberSummaryQuery()
  if (!summary.data) return null
  const { confirmed, pending, unsubscribed } = summary.data
  return (
    <p className="text-sm text-muted-foreground" data-testid="subscriber-summary">
      {confirmed} confirmed · {pending} awaiting confirmation · {unsubscribed} unsubscribed — <Link to="/content/newsletter" className="underline underline-offset-4">see subscribers</Link>
    </p>
  )
}

export function NewsletterCampaignsPage() {
  const [page, setPage] = useState(1)
  const campaigns = useNewsletterCampaignsQuery(page)

  return (
    <div className="flex flex-col gap-6">
      <MarketingHeader
        actions={
          <Button asChild>
            <Link to="/marketing/newsletter/new"><PlusIcon data-icon="inline-start" /> New campaign</Link>
          </Button>
        }
      />
      <Card>
        <CardHeader>
          <CardTitle><h2>Newsletter campaigns</h2></CardTitle>
          <CardDescription>E-mails to everyone who confirmed their newsletter sign-up. Each e-mail carries an unsubscribe link.</CardDescription>
          <SubscriberSummaryLine />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {campaigns.isPending ? (
            <LoadingState label="Loading campaigns" />
          ) : campaigns.error ? (
            <ErrorState error={campaigns.error} onRetry={() => void campaigns.refetch()} />
          ) : campaigns.data.items.length === 0 ? (
            <EmptyState title="No campaigns yet" description="Write your first newsletter e-mail." />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Subject</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Sent</TableHead>
                    <TableHead className="hidden md:table-cell">Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {campaigns.data.items.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell><Link to={`/marketing/newsletter/${c.id}`} className="font-medium underline-offset-4 hover:underline">{c.subject}</Link></TableCell>
                      <TableCell><Badge variant={STATUS[c.status]?.variant ?? 'outline'}>{STATUS[c.status]?.label ?? c.status}</Badge></TableCell>
                      <TableCell className="text-right tabular-nums">{c.status === 'draft' ? '—' : `${c.sent_count} / ${c.recipients_count}`}</TableCell>
                      <TableCell className="hidden text-sm whitespace-nowrap text-muted-foreground md:table-cell">{date(c.sent_at ?? c.updated_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <PaginationBar pagination={campaigns.data.pagination} onPageChange={setPage} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/** `/marketing/newsletter/new` writes a draft; an existing draft can be edited, tested and sent. */
export function NewsletterCampaignPage() {
  const { campaignId } = useParams()
  const isNew = campaignId === 'new'
  const campaign = useNewsletterCampaignQuery(isNew ? undefined : campaignId)

  if (isNew) return <CampaignEditor />
  if (campaign.isPending) return <LoadingState rows={6} label="Loading campaign" />
  if (campaign.error) return <ErrorState error={campaign.error} onRetry={() => void campaign.refetch()} />
  return <CampaignEditor key={campaign.data.id} campaign={campaign.data} />
}

function CampaignEditor({ campaign }: { campaign?: NewsletterCampaign }) {
  const navigate = useNavigate()
  const save = useSaveNewsletterCampaignMutation(campaign?.id)
  const [subject, setSubject] = useState(campaign?.subject ?? '')
  const [body, setBody] = useState(campaign?.body ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const isDraft = !campaign || campaign.status === 'draft'
  const dirty = subject !== (campaign?.subject ?? '') || body !== (campaign?.body ?? '')
  const status = campaign ? STATUS[campaign.status] : STATUS.draft

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const found: Record<string, string> = {}
    if (subject.trim() === '') found.subject = 'Write a subject.'
    else if (subject.length > MAX_SUBJECT) found.subject = `Up to ${MAX_SUBJECT} characters.`
    if (body.trim() === '') found.body = 'Write the e-mail.'
    setErrors(found)
    if (Object.keys(found).length > 0) return
    save.mutate(
      { subject: subject.trim(), body },
      {
        onSuccess: (saved) => {
          toast.success('Draft saved.')
          if (!campaign) navigate(`/marketing/newsletter/${saved.id}`, { replace: true })
        },
        onError: (error) => setErrors(fieldErrorMap(error)),
      },
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label="Back to newsletter campaigns"><Link to="/marketing/newsletter"><ArrowLeftIcon /></Link></Button>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">{campaign ? campaign.subject : 'New newsletter campaign'}</h1>
        <Badge variant={status?.variant ?? 'outline'}>{status?.label ?? campaign?.status}</Badge>
      </div>

      {campaign && !isDraft && (
        <p role="status" className="text-sm" data-testid="campaign-progress">
          {campaign.status === 'sending'
            ? `Sending… ${campaign.sent_count} of ${plural(campaign.recipients_count, 'subscriber')} so far.`
            : `Sent to ${plural(campaign.sent_count, 'subscriber')}${campaign.sent_at ? ` on ${new Date(campaign.sent_at).toLocaleString()}` : ''}.`}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle><h2>E-mail</h2></CardTitle>
            <CardDescription>Plain text with simple markdown: **bold**, *italic*, lists and # headings. HTML is shown as text.</CardDescription>
          </CardHeader>
          <CardContent>
            <form noValidate onSubmit={submit} aria-label="Campaign draft" className="flex flex-col gap-4">
              <FormField label="Subject" error={errors.subject}>
                <Input value={subject} maxLength={MAX_SUBJECT} readOnly={!isDraft} onChange={(e) => setSubject(e.target.value)} />
              </FormField>
              <FormField label="Message (markdown)" error={errors.body}>
                <Textarea rows={14} className="font-mono text-sm" value={body} readOnly={!isDraft} onChange={(e) => setBody(e.target.value)} />
              </FormField>
              {errors.form && <p role="alert" className="text-sm text-destructive">{errors.form}</p>}
              {isDraft && (
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" disabled={save.isPending || (!!campaign && !dirty)}>
                    {save.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
                    Save draft
                  </Button>
                  {campaign && <DeleteDraft id={campaign.id} />}
                </div>
              )}
            </form>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle><h2>Preview</h2></CardTitle>
            </CardHeader>
            <CardContent data-testid="campaign-preview">
              {body.trim() === '' ? <p className="text-sm text-muted-foreground">The e-mail appears here as you write.</p> : <SafeMarkdown text={body} />}
            </CardContent>
          </Card>
          {campaign && isDraft && <SendCard campaign={campaign} dirty={dirty} />}
        </div>
      </div>
    </div>
  )
}

function DeleteDraft({ id }: { id: string }) {
  const navigate = useNavigate()
  const remove = useDeleteNewsletterCampaignMutation()
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}><Trash2Icon data-icon="inline-start" /> Delete draft</Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete this draft?"
        description="The draft is removed for good."
        confirmLabel="Delete"
        pending={remove.isPending}
        onConfirm={() =>
          remove.mutate(id, {
            onSuccess: () => {
              toast.success('Draft deleted.')
              navigate('/marketing/newsletter')
            },
            onError: (e) => toast.error(e.message),
          })
        }
      />
    </>
  )
}

function SendCard({ campaign, dirty }: { campaign: NewsletterCampaign; dirty: boolean }) {
  const summary = useSubscriberSummaryQuery()
  const test = useTestNewsletterCampaignMutation(campaign.id)
  const send = useSendNewsletterCampaignMutation(campaign.id)
  const [email, setEmail] = useState('')
  const [testError, setTestError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const confirmed = summary.data?.confirmed ?? 0

  const sendTest = (e: FormEvent) => {
    e.preventDefault()
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setTestError('Enter an e-mail address.')
      return
    }
    setTestError(null)
    test.mutate(email.trim(), {
      onSuccess: () => toast.success(`Test e-mail sent to ${email.trim()}.`),
      onError: (error) => setTestError(fieldErrorMap(error).email ?? error.message),
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle><h2>Send</h2></CardTitle>
        <CardDescription>{dirty ? 'Save the draft first: tests and the campaign use the saved text.' : 'Send yourself a test first; the subject starts with “[Test]”.'}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form noValidate onSubmit={sendTest} className="flex flex-wrap items-end gap-2" aria-label="Test e-mail">
          <FormField label="Send a test to" error={testError ?? undefined} className="min-w-56 flex-1">
            <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </FormField>
          <Button type="submit" variant="outline" disabled={dirty || test.isPending}>
            {test.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            Send test
          </Button>
        </form>
        <Button className="self-start" disabled={dirty || send.isPending || confirmed === 0} onClick={() => setConfirming(true)}>
          <SendIcon data-icon="inline-start" /> Send to {plural(confirmed, 'subscriber')}
        </Button>
        {summary.data && confirmed === 0 && <p className="text-sm text-muted-foreground">No confirmed subscribers yet.</p>}
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={`Send to ${plural(confirmed, 'subscriber')}?`}
          description={`“${campaign.subject}” goes to every confirmed subscriber. It cannot be stopped or sent again.`}
          confirmLabel="Send now"
          destructive={false}
          pending={send.isPending}
          onConfirm={() =>
            send.mutate(undefined, {
              onSuccess: () => {
                setConfirming(false)
                toast.success('Sending started.')
              },
              onError: (e) => {
                setConfirming(false)
                toast.error(e.message)
              },
            })
          }
        />
      </CardContent>
    </Card>
  )
}
