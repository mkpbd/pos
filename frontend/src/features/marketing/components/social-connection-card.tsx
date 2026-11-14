import { useState } from 'react'
import { FlaskConicalIcon, PlugZapIcon, UnplugIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { NetworkIcon } from '@/features/marketing/components/network-icon'
import { connectErrorText } from '@/features/marketing/social'
import {
  SOCIAL_CONNECT_URL,
  useDisconnectSocialMutation,
  useSelectSocialPageMutation,
  type SocialAccounts,
  type SocialMode,
} from '@/features/marketing/social-api'
import { formatDateTime } from '@/features/web-orders/orders'
import { fieldErrorMap } from '@/lib/forms'

export function ModeBadge({ mode }: { mode: SocialMode }) {
  return mode === 'sandbox' ? (
    <Badge variant="warning" data-testid="social-mode">
      <FlaskConicalIcon aria-hidden /> Practice mode (sandbox)
    </Badge>
  ) : (
    <Badge variant="success" data-testid="social-mode">
      Live
    </Badge>
  )
}

type Props = {
  accounts: SocialAccounts
  /** Live mode needs the app id and secret first (settings `live_ready`). */
  liveReady: boolean
  canManage: boolean
  timeZone: string | undefined
  /** `?error=` from the Facebook connection, until dismissed. */
  connectError: string | null
  onDismissError: () => void
}

/** The connected Facebook Page and Instagram account: connect, switch Page, disconnect. */
export function SocialConnectionCard({ accounts, liveReady, canManage, timeZone, connectError, onDismissError }: Props) {
  const select = useSelectSocialPageMutation()
  const disconnect = useDisconnectSocialMutation()
  const [confirming, setConfirming] = useState(false)
  const sandbox = accounts.mode === 'sandbox'
  const canConnect = sandbox || liveReady

  const pickPage = (pageId: string) =>
    select.mutate(pageId, {
      onSuccess: (saved) => toast.success(`Posts now go to ${saved.page?.name ?? 'the chosen Page'}.`),
      onError: (e) => toast.error(fieldErrorMap(e).page_id ?? e.message),
    })

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Facebook & Instagram</h2>
        </CardTitle>
        <CardDescription>Post your products to your Facebook Page and Instagram business account from here.</CardDescription>
        <CardAction>
          <ModeBadge mode={accounts.mode} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {connectError && (
          <div role="alert" className="flex items-start justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <p>
              <span className="font-medium">Facebook was not connected. </span>
              {connectErrorText(connectError)}
            </p>
            <Button variant="ghost" size="icon-sm" aria-label="Dismiss the message" onClick={onDismissError}>
              <XIcon />
            </Button>
          </div>
        )}

        {sandbox && (
          <p role="note" className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
            Practice mode: nothing is sent to Facebook or Instagram. You get a demo Page and pretend post links, so you can try everything safely. Switch to
            Live under “Meta app” once you have a Meta app.
          </p>
        )}

        {accounts.connected && accounts.page ? (
          <>
            <dl className="grid gap-3 sm:grid-cols-2">
              <div className="flex items-start gap-3 rounded-md border p-3">
                <NetworkIcon target="facebook" className="mt-0.5" />
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">Facebook Page</dt>
                  <dd className="truncate font-medium" data-testid="social-page-name">{accounts.page.name}</dd>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-md border p-3">
                <NetworkIcon target="instagram" className="mt-0.5" />
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">Instagram</dt>
                  <dd className="font-medium" data-testid="social-instagram">
                    {accounts.instagram ? (
                      <span className="truncate">@{accounts.instagram.username}</span>
                    ) : (
                      <span className="text-sm font-normal text-muted-foreground">
                        No Instagram business account is linked to this Page. Link one in the Page’s settings on Facebook, then connect again.
                      </span>
                    )}
                  </dd>
                </div>
              </div>
            </dl>
            {accounts.connected_at && (
              <p className="text-xs text-muted-foreground">
                Connected {formatDateTime(accounts.connected_at, timeZone)}
                {accounts.connected_by ? ` by ${accounts.connected_by.name}` : ''}.
              </p>
            )}
            {canManage && (
              <div className="flex flex-wrap items-end gap-3">
                {accounts.pages.length > 1 && (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="social-page">Post to Page</Label>
                    <Select value={accounts.page.id} disabled={select.isPending} onValueChange={pickPage}>
                      <SelectTrigger id="social-page" className="w-full sm:w-72">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {accounts.pages.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name} {p.instagram ? `(Instagram @${p.instagram.username})` : '(no Instagram)'}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <Button variant="outline" onClick={() => setConfirming(true)}>
                  <UnplugIcon data-icon="inline-start" /> Disconnect
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              {sandbox
                ? 'Nothing is connected yet. Connect the demo Page to try posting.'
                : 'Nothing is connected yet. Facebook asks you to log in and choose the Page you sell from; its Instagram business account comes with it.'}
            </p>
            {canManage &&
              (canConnect ? (
                <Button asChild className="self-start">
                  <a href={SOCIAL_CONNECT_URL}>
                    <PlugZapIcon data-icon="inline-start" /> {sandbox ? 'Connect the demo Page' : 'Connect Facebook'}
                  </a>
                </Button>
              ) : (
                <div className="flex flex-col gap-1">
                  <Button className="self-start" disabled aria-describedby="social-connect-help">
                    <PlugZapIcon data-icon="inline-start" /> Connect Facebook
                  </Button>
                  <p id="social-connect-help" className="text-sm text-muted-foreground">
                    Enter your Meta app ID and app secret under “Meta app” below first.
                  </p>
                </div>
              ))}
            {!canManage && <p className="text-sm text-muted-foreground">Ask someone who manages social media to connect Facebook.</p>}
          </div>
        )}
      </CardContent>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Disconnect Facebook?"
        description="Nothing can be posted until you connect again, and scheduled posts fail at their time. Posts already on Facebook and Instagram stay there."
        confirmLabel="Disconnect"
        pending={disconnect.isPending}
        onConfirm={() =>
          disconnect.mutate(undefined, {
            onSuccess: () => toast.success('Facebook is disconnected.'),
            onError: (e) => toast.error(e.message),
            onSettled: () => setConfirming(false),
          })
        }
      />
    </Card>
  )
}
