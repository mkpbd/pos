import { useState, type FormEvent } from 'react'
import { Loader2Icon, MonitorSmartphoneIcon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { FormField } from '@/components/common/form-field'
import { PageHeader } from '@/components/common/page-header'
import { StoreSelect } from '@/components/common/store-select'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { TILL_NAME_MAX, useRevokeTillMutation, useSetUpTillMutation, useTillsQuery, type Till } from '@/features/tills/api'
import { ApiError } from '@/lib/api/client'

type Errors = { store_id?: string; name?: string; form?: string }

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Never')

function toErrors(error: unknown): Errors {
  if (error instanceof ApiError && error.code === 'VALIDATION_FAILED') {
    const mapped = { store_id: error.fieldErrors.store_id?.[0], name: error.fieldErrors.name?.[0] }
    if (mapped.store_id || mapped.name) return mapped
  }
  return { form: error instanceof Error ? error.message : 'Something went wrong.' }
}

function SetUpForm({ replacing, onDone }: { replacing: boolean; onDone?: () => void }) {
  const setUp = useSetUpTillMutation()
  const [storeId, setStoreId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [errors, setErrors] = useState<Errors>({})

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    const trimmed = name.trim()
    const next: Errors = {
      store_id: storeId ? undefined : 'Choose the store this till sells from.',
      name: !trimmed ? 'Enter a name, e.g. Counter 1.' : trimmed.length > TILL_NAME_MAX ? `At most ${TILL_NAME_MAX} characters.` : undefined,
    }
    setErrors(next)
    if (next.store_id || next.name || !storeId) return
    setUp.mutate(
      { store_id: storeId, name: trimmed },
      {
        onSuccess: (till) => {
          toast.success(`This device is now the till “${till.name}”.`)
          setName('')
          setStoreId(null)
          onDone?.()
        },
        onError: (e) => setErrors(toErrors(e)),
      },
    )
  }

  return (
    <form onSubmit={onSubmit} noValidate aria-label="Set up this device as a till" className="flex flex-col gap-4">
      {errors.form && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{errors.form}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Store" error={errors.store_id} hint="Sales on this till come from this store’s stock.">
          <StoreSelect value={storeId} onChange={setStoreId} aria-label="Store" invalid={!!errors.store_id} />
        </FormField>
        <FormField label="Till name" error={errors.name} hint="Shown on the till sign-in screen.">
          <Input maxLength={TILL_NAME_MAX} placeholder="e.g. Counter 1" value={name} onChange={(e) => setName(e.target.value)} />
        </FormField>
      </div>
      {replacing && <p className="text-sm text-muted-foreground">This device stops being its current till; that till stays in the list until you revoke it.</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={setUp.isPending}>
          {setUp.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
          Set up this device as a till
        </Button>
        {onDone && <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>}
      </div>
    </form>
  )
}

function ThisDeviceCard({ current }: { current: Till | undefined }) {
  const [replacing, setReplacing] = useState(false)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MonitorSmartphoneIcon className="size-4 text-muted-foreground" aria-hidden /> This device
        </CardTitle>
        <CardDescription>
          A till device opens the PIN sign-in: staff tap their name and enter their PIN. Set it up on the counter computer or tablet itself.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {current && !replacing ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm" data-testid="this-device-till">
              This device is the till <span className="font-medium">{current.name}</span>
              {current.store && <> at <span className="font-medium">{current.store.name}</span></>}.
            </p>
            <Button variant="outline" onClick={() => setReplacing(true)}>Set up again</Button>
          </div>
        ) : (
          <SetUpForm replacing={!!current} onDone={current ? () => setReplacing(false) : undefined} />
        )}
      </CardContent>
    </Card>
  )
}

/** /settings/tills (POS1a, pos.terminals.manage): set up this device as a till, list and revoke tills. */
export function TillsPage() {
  const { data, error, isPending, refetch } = useTillsQuery()
  const revoke = useRevokeTillMutation()
  const [revoking, setRevoking] = useState<Till | null>(null)
  const tills = [...(data ?? [])].sort((a, b) => Number(!!a.revoked_at) - Number(!!b.revoked_at))
  const current = tills.find((t) => t.is_this_device && !t.revoked_at)

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader title="Tills" description="Devices staff sign in to with their PIN, and where managers approve price changes and discounts." />

      {isPending ? (
        <LoadingState rows={4} label="Loading tills" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (
        <>
          <ThisDeviceCard key={current?.id ?? 'none'} current={current} />
          <Card>
            <CardHeader>
              <CardTitle>All tills</CardTitle>
              <CardDescription>Revoke a till when the device is lost, replaced or moved; it goes back to the normal sign-in.</CardDescription>
            </CardHeader>
            <CardContent>
              {tills.length === 0 ? (
                <EmptyState title="No tills yet" description="Set up the counter device above to use PIN sign-in." />
              ) : (
                <div className="overflow-x-auto">
                  <Table aria-label="Tills">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Till</TableHead>
                        <TableHead className="hidden sm:table-cell">Store</TableHead>
                        <TableHead className="hidden md:table-cell">Last used</TableHead>
                        <TableHead className="hidden lg:table-cell">Set up by</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="w-24 text-right"><span className="sr-only">Actions</span></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tills.map((till) => (
                        <TableRow key={till.id} className={till.revoked_at ? 'text-muted-foreground' : undefined}>
                          <TableCell>
                            <div className="flex flex-wrap items-center gap-1.5 font-medium">
                              {till.name}
                              {till.is_this_device && !till.revoked_at && <Badge variant="info">This device</Badge>}
                            </div>
                            <div className="text-xs text-muted-foreground sm:hidden">{till.store?.name ?? '—'}</div>
                          </TableCell>
                          <TableCell className="hidden text-sm sm:table-cell">{till.store?.name ?? '—'}</TableCell>
                          <TableCell className="hidden text-sm md:table-cell">{when(till.last_used_at)}</TableCell>
                          <TableCell className="hidden text-sm lg:table-cell">
                            {till.created_by?.name ?? '—'}
                            <div className="text-xs text-muted-foreground">{when(till.created_at)}</div>
                          </TableCell>
                          <TableCell>
                            {till.revoked_at ? (
                              <Badge variant="outline" title={`Revoked ${when(till.revoked_at)}`}>Revoked</Badge>
                            ) : (
                              <Badge variant="success">Active</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {!till.revoked_at && (
                              <Button variant="outline" size="sm" aria-label={`Revoke ${till.name}`} onClick={() => setRevoking(till)}>
                                Revoke
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={`Revoke the till “${revoking?.name ?? ''}”?`}
        description={
          revoking?.is_this_device
            ? 'This device stops being a till and goes back to the normal sign-in. You can set it up again later.'
            : 'That device stops being a till and goes back to the normal sign-in. You can set it up again later.'
        }
        confirmLabel="Revoke till"
        pending={revoke.isPending}
        onConfirm={() => {
          if (!revoking) return
          const till = revoking
          revoke.mutate(till.id, {
            onSuccess: () => toast.success(`${till.name} revoked.`),
            onError: (e) => toast.error(e.message),
            onSettled: () => setRevoking(null),
          })
        }}
      />
    </div>
  )
}
