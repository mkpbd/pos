import { useState } from 'react'
import { Link } from 'react-router'
import { CopyIcon, PencilIcon, QrCodeIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAuth, useCan } from '@/features/auth/use-auth'
import { useDeleteShortLinkMutation, type ShortLink } from '@/features/marketing/api'
import { copyText } from '@/features/marketing/clipboard'
import { QrDialog } from '@/features/marketing/components/qr-dialog'
import { ShortLinkDialog } from '@/features/marketing/components/short-link-dialog'
import { formatCount, sourceLabel } from '@/features/marketing/marketing'
import { formatDateTime } from '@/features/web-orders/orders'

/** Short links with copy, QR, edit and delete; `showCampaign` off on a campaign's own page. */
export function ShortLinksTable({ links, showCampaign = true }: { links: ShortLink[]; showCampaign?: boolean }) {
  const me = useAuth()
  const canManage = useCan()('marketing.manage')
  const remove = useDeleteShortLinkMutation()
  const [editing, setEditing] = useState<ShortLink | null>(null)
  const [qr, setQr] = useState<ShortLink | null>(null)
  const [removing, setRemoving] = useState<ShortLink | null>(null)
  const timeZone = me.organization?.timezone

  return (
    <>
      <div className="overflow-x-auto rounded-md border">
        <Table aria-label="Short links">
          <TableHeader>
            <TableRow>
              <TableHead>Link</TableHead>
              <TableHead className="hidden md:table-cell">Opens</TableHead>
              {showCampaign && <TableHead className="hidden lg:table-cell">Campaign</TableHead>}
              <TableHead className="hidden sm:table-cell">Shared on</TableHead>
              <TableHead className="text-right">Clicks</TableHead>
              <TableHead className="w-0"><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {links.map((l) => (
              <TableRow key={l.id} data-testid={`short-link-${l.code}`}>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-medium">/go/{l.code}</span>
                    {!l.active && <Badge variant="outline">Off</Badge>}
                  </div>
                  {l.url ? <div className="font-mono text-xs break-all text-muted-foreground">{l.url}</div> : <div className="text-xs text-muted-foreground">Add a store domain to share it.</div>}
                </TableCell>
                <TableCell className="hidden font-mono text-xs break-all md:table-cell">{l.target_path}</TableCell>
                {showCampaign && (
                  <TableCell className="hidden text-sm lg:table-cell">
                    {l.campaign ? <Link to={`/marketing/campaigns/${l.campaign.id}`} className="underline-offset-4 hover:underline">{l.campaign.name}</Link> : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                )}
                <TableCell className="hidden text-sm sm:table-cell">{l.utm.source || l.utm.medium ? sourceLabel(l.utm.source, l.utm.medium) : <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell className="text-right">
                  <span className="font-mono">{formatCount(l.clicks)}</span>
                  {l.last_clicked_at && <div className="text-xs whitespace-nowrap text-muted-foreground">Last {formatDateTime(l.last_clicked_at, timeZone)}</div>}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon-sm" aria-label={`Copy /go/${l.code}`} disabled={!l.url} onClick={() => l.url && void copyText(l.url)}><CopyIcon /></Button>
                    <Button variant="ghost" size="icon-sm" aria-label={`QR code for /go/${l.code}`} disabled={!l.url} onClick={() => setQr(l)}><QrCodeIcon /></Button>
                    {canManage && (
                      <>
                        <Button variant="ghost" size="icon-sm" aria-label={`Edit /go/${l.code}`} onClick={() => setEditing(l)}><PencilIcon /></Button>
                        <Button variant="ghost" size="icon-sm" aria-label={`Delete /go/${l.code}`} onClick={() => setRemoving(l)}><Trash2Icon /></Button>
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {editing && <ShortLinkDialog key={editing.id} link={editing} onClose={() => setEditing(null)} />}
      {qr?.url && <QrDialog url={qr.url} code={qr.code} onClose={() => setQr(null)} />}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Delete /go/${removing?.code}?`}
        description="Anyone who clicks this link afterwards lands on your home page. Orders it already brought keep their campaign. To pause it instead, edit it and switch it off."
        confirmLabel="Delete"
        pending={remove.isPending}
        onConfirm={() =>
          removing &&
          remove.mutate(removing.id, {
            onSuccess: () => toast.success(`/go/${removing.code} deleted.`),
            onError: (e) => toast.error(e.message),
            onSettled: () => setRemoving(null),
          })
        }
      />
    </>
  )
}
