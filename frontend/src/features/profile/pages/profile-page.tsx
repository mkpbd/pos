import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2Icon, MonitorSmartphoneIcon } from 'lucide-react'
import { toast } from 'sonner'
import { FormField } from '@/components/common/form-field'
import { PageHeader } from '@/components/common/page-header'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { changePasswordSchema, type ChangePasswordValues } from '@/features/auth/schemas'
import { useAuth } from '@/features/auth/use-auth'
import { useChangePasswordMutation, useDeviceTokensQuery, useMyLoginActivityQuery, useRevokeTokenMutation } from '@/features/profile/api'
import { handleFormError } from '@/lib/forms'

function ChangePasswordCard() {
  const change = useChangePasswordMutation()
  const form = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { current_password: '', password: '', password_confirmation: '' },
  })
  const { errors } = form.formState

  const onSubmit = form.handleSubmit((values) =>
    change.mutate(values, {
      onSuccess: () => {
        toast.success('Password changed. Other sessions and devices were signed out.')
        form.reset()
      },
      onError: (error) => handleFormError(error, form.setError, ['current_password', 'password', 'password_confirmation']),
    }),
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Change password</CardTitle>
        <CardDescription>Signs you out everywhere except this browser.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <FormField label="Current password" error={errors.current_password?.message}>
            <Input type="password" autoComplete="current-password" {...form.register('current_password')} />
          </FormField>
          <FormField label="New password" error={errors.password?.message}>
            <Input type="password" autoComplete="new-password" {...form.register('password')} />
          </FormField>
          <FormField label="Confirm new password" error={errors.password_confirmation?.message}>
            <Input type="password" autoComplete="new-password" {...form.register('password_confirmation')} />
          </FormField>
          <Button type="submit" className="self-start" disabled={change.isPending}>
            {change.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            Change password
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function DevicesCard() {
  const { data, error, isPending, refetch } = useDeviceTokensQuery()
  const revoke = useRevokeTokenMutation()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Devices</CardTitle>
        <CardDescription>Terminals and integrations signed in with an access token.</CardDescription>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <LoadingState rows={2} label="Loading devices" />
        ) : error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : data.length === 0 ? (
          <EmptyState title="No devices" description="Only the web app is signed in." />
        ) : (
          <ul className="flex flex-col divide-y">
            {data.map((token) => (
              <li key={token.id} className="flex items-center justify-between gap-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <MonitorSmartphoneIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{token.name} {token.is_current && <Badge variant="secondary">This device</Badge>}</p>
                    <p className="text-xs text-muted-foreground">
                      Last used {token.last_used_at ? new Date(token.last_used_at).toLocaleString() : 'never'}
                      {token.expires_at && ` · expires ${new Date(token.expires_at).toLocaleDateString()}`}
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate(token.id, { onSuccess: () => toast.success(`${token.name} signed out.`), onError: (e) => toast.error(e.message) })}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function LoginActivityCard() {
  const [page, setPage] = useState(1)
  const { data, error, isPending, refetch } = useMyLoginActivityQuery(page)

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>Recent sign-in activity</CardTitle>
        <CardDescription>Report anything you don’t recognise to your administrator.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {isPending ? (
          <LoadingState rows={3} label="Loading sign-in activity" />
        ) : error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : data.items.length === 0 ? (
          <EmptyState title="No sign-ins recorded" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead>Via</TableHead>
                    <TableHead className="hidden md:table-cell">IP address</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="whitespace-nowrap text-sm">{new Date(a.created_at).toLocaleString()}</TableCell>
                      <TableCell>
                        {a.succeeded ? <Badge variant="success">Success</Badge> : <Badge variant="destructive">{a.failure_reason?.replaceAll('_', ' ') ?? 'Failed'}</Badge>}
                      </TableCell>
                      <TableCell className="text-sm">{a.channel === 'session' ? 'Web' : 'Device'}</TableCell>
                      <TableCell className="hidden font-mono text-xs md:table-cell">{a.ip_address ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <PaginationBar pagination={data.pagination} onPageChange={setPage} />
          </>
        )}
      </CardContent>
    </Card>
  )
}

export function ProfilePage() {
  const me = useAuth()

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Profile & security" description={`${me.user.name} · ${me.user.email}`} />
      <div className="grid gap-6 lg:grid-cols-2">
        <ChangePasswordCard />
        <DevicesCard />
        <LoginActivityCard />
      </div>
    </div>
  )
}
