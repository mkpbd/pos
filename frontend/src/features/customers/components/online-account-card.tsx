import { useState } from 'react'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth, useCan } from '@/features/auth/use-auth'
import { useCustomerQuery, useSetOnlineAccountStatusMutation, type OnlineAccountStatus } from '@/features/customers/api'

/** Dates are shown in the organization's timezone, not the browser's. */
function formatInZone(iso: string, timeZone: string | undefined, withTime: boolean): string {
  return new Date(iso).toLocaleString(undefined, { timeZone, dateStyle: 'medium', ...(withTime ? { timeStyle: 'short' } : {}) })
}

/** The customer's online store sign-in: read for customers.view, disable/enable for customers.manage. */
export function OnlineAccountCard({ customerId }: { customerId: string }) {
  const me = useAuth()
  const can = useCan()
  const canManage = can('customers.manage')
  const timeZone = me.organization?.timezone
  const { data, error, isPending, refetch } = useCustomerQuery(customerId)
  const setStatus = useSetOnlineAccountStatusMutation()
  const [confirmingDisable, setConfirmingDisable] = useState(false)

  const change = (status: OnlineAccountStatus) =>
    setStatus.mutate(
      { customerId, status },
      {
        onSuccess: (a) => toast.success(a.status === 'disabled' ? 'Online account disabled.' : 'Online account enabled.'),
        onError: (e) => toast.error(e.message),
        onSettled: () => setConfirmingDisable(false),
      },
    )

  const account = data?.online_account ?? null
  const active = account?.status === 'active'

  return (
    <Card size="sm" aria-labelledby="online-account-title" role="region">
      <CardHeader>
        <CardTitle id="online-account-title">Online store account</CardTitle>
        {canManage && account && (
          <CardAction>
            <Button
              size="sm"
              variant={active ? 'outline' : 'default'}
              disabled={setStatus.isPending}
              onClick={() => (active ? setConfirmingDisable(true) : change('active'))}
            >
              {setStatus.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
              {active ? 'Disable' : 'Enable'}
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {isPending ? (
          <LoadingState rows={2} label="Loading online account" />
        ) : error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : !account ? (
          <p className="text-sm text-muted-foreground">No online account</p>
        ) : (
          <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">E-mail</dt>
              <dd className="break-all">{account.email}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Status</dt>
              <dd><Badge variant={active ? 'success' : 'destructive'}>{active ? 'Active' : 'Disabled'}</Badge></dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">E-mail verified</dt>
              <dd>{account.email_verified_at ? formatInZone(account.email_verified_at, timeZone, false) : 'Not verified'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Last sign-in</dt>
              <dd>{account.last_login_at ? formatInZone(account.last_login_at, timeZone, true) : 'Never'}</dd>
            </div>
          </dl>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirmingDisable}
        onOpenChange={setConfirmingDisable}
        title="Disable online account?"
        description="The customer can no longer sign in to the online store."
        confirmLabel="Disable"
        pending={setStatus.isPending}
        onConfirm={() => change('disabled')}
      />
    </Card>
  )
}
