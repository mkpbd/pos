import { useEffect, useState, type FormEvent } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ExternalLinkIcon, Loader2Icon, PlusIcon, StarIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { FormField } from '@/components/common/form-field'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useCan } from '@/features/auth/use-auth'
import { useBranchesQuery } from '@/features/branches/api'
import {
  useAddDomainMutation,
  useMakeDomainPrimaryMutation,
  useRemoveDomainMutation,
  useSaveStorefrontSettingsMutation,
  useStorefrontDomainsQuery,
  useStorefrontSettingsQuery,
  type StorefrontDomain,
  type StorefrontSettings,
} from '@/features/storefront/api'
import { StorefrontHeader } from '@/features/storefront/components/storefront-header'
import { fieldErrorMap, handleFormError } from '@/lib/forms'

const schema = z.object({
  site_name: z.string().trim().min(1, 'Required.').max(120),
  meta_description: z.string().trim().max(300),
})
type Values = z.infer<typeof schema>
const FIELDS = ['site_name', 'meta_description'] as const

function StatusCard({ settings, primary, canManage }: { settings: StorefrontSettings; primary: StorefrontDomain | undefined; canManage: boolean }) {
  const save = useSaveStorefrontSettingsMutation()

  const toggle = (open: boolean) =>
    save.mutate(
      { is_enabled: open },
      {
        onSuccess: (s) => toast.success(s.is_enabled ? 'The online store is open.' : 'The online store is closed.'),
        onError: (e) => toast.error(e.message),
      },
    )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Status</CardTitle>
        <CardDescription>A closed store is only visible to your staff (preview while signed in).</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Switch id="store-open" checked={settings.is_enabled} disabled={!canManage || save.isPending} onCheckedChange={toggle} />
          <Label htmlFor="store-open">Store open to customers</Label>
        </div>
        <Badge variant={settings.is_enabled ? 'success' : 'outline'}>{settings.is_enabled ? 'Open' : 'Closed'}</Badge>
        {primary && (
          <a href={`https://${primary.host}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline">
            https://{primary.host} <ExternalLinkIcon className="size-3.5" />
          </a>
        )}
      </CardContent>
    </Card>
  )
}

function DetailsCard({ settings, canManage }: { settings: StorefrontSettings; canManage: boolean }) {
  const save = useSaveStorefrontSettingsMutation()
  const toValues = (s: StorefrontSettings): Values => ({ site_name: s.site_name, meta_description: s.meta_description ?? '' })
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: toValues(settings) })
  const { errors, isDirty } = form.formState

  useEffect(() => {
    form.reset(toValues(settings))
  }, [settings, form])

  const onSubmit = form.handleSubmit((v) =>
    save.mutate(
      { site_name: v.site_name, meta_description: v.meta_description || null },
      { onSuccess: () => toast.success('Store details saved.'), onError: (e) => handleFormError(e, form.setError, FIELDS) },
    ),
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Store details</CardTitle>
        <CardDescription>Shown in browser tabs, search results and link previews.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <fieldset disabled={!canManage} className="flex flex-col gap-4">
            <FormField label="Store name" error={errors.site_name?.message}><Input {...form.register('site_name')} /></FormField>
            <FormField label="Description" error={errors.meta_description?.message} hint="One or two sentences for search engines (max. 300 characters).">
              <Textarea rows={3} {...form.register('meta_description')} />
            </FormField>
          </fieldset>
          {canManage && (
            <Button type="submit" className="self-start" disabled={save.isPending || !isDirty}>
              {save.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
              Save details
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  )
}

const NO_STORE = '__none__'
const FULFILMENT_HELP = 'Stock-tracked products show as out of stock until a fulfilment store is chosen.'

function AvailabilityCard({ settings, canManage }: { settings: StorefrontSettings; canManage: boolean }) {
  const save = useSaveStorefrontSettingsMutation()
  const branches = useBranchesQuery({ page: 1, per_page: 100, is_active: true })
  const [error, setError] = useState<string | undefined>()
  const groups = (branches.data?.items ?? []).map((b) => ({ branch: b, stores: b.stores.filter((s) => s.is_active || s.id === settings.fulfilment_store_id) })).filter((g) => g.stores.length > 0)

  const change = (value: string) => {
    setError(undefined)
    save.mutate(
      { fulfilment_store_id: value === NO_STORE ? null : value },
      {
        onSuccess: () => toast.success('Fulfilment store saved.'),
        onError: (e) => {
          const map = fieldErrorMap(e)
          setError(map.fulfilment_store_id ?? map.form)
        },
      },
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stock & availability</CardTitle>
        <CardDescription>The online store shows a product as in stock while this store has it. Exact quantities are never shown.</CardDescription>
      </CardHeader>
      <CardContent>
        <FormField label="Fulfilment store" error={error} hint={FULFILMENT_HELP}>
          <Select value={settings.fulfilment_store_id ?? NO_STORE} onValueChange={change} disabled={!canManage || save.isPending}>
            <SelectTrigger className="w-full sm:w-80" aria-label="Fulfilment store"><SelectValue placeholder={branches.isPending ? 'Loading stores…' : undefined} /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_STORE}>No fulfilment store</SelectItem>
              {groups.map(({ branch, stores }) => (
                <SelectGroup key={branch.id}>
                  <SelectLabel>{branch.name}</SelectLabel>
                  {stores.map((s) => <SelectItem key={s.id} value={s.id}>{s.name} ({s.code})</SelectItem>)}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      </CardContent>
    </Card>
  )
}

function DomainsCard({ domains, canManage }: { domains: StorefrontDomain[]; canManage: boolean }) {
  const add = useAddDomainMutation()
  const makePrimary = useMakeDomainPrimaryMutation()
  const remove = useRemoveDomainMutation()
  const [host, setHost] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [removing, setRemoving] = useState<StorefrontDomain | null>(null)

  const onAdd = (e: FormEvent) => {
    e.preventDefault()
    setError(undefined)
    add.mutate(host.trim(), {
      onSuccess: (d) => {
        toast.success(`${d.host} added.`)
        setHost('')
      },
      onError: (err) => {
        const map = fieldErrorMap(err)
        setError(map.host ?? map.form)
      },
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Domains</CardTitle>
        <CardDescription>Host names that open this store. Point their DNS at your server; the primary domain is used in links and search results.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {domains.length === 0 ? (
          <EmptyState title="No domains yet" description="Add one before opening the store." />
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Host</TableHead>
                  <TableHead>Role</TableHead>
                  {canManage && <TableHead className="w-48"><span className="sr-only">Actions</span></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {domains.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.host}</TableCell>
                    <TableCell>{d.is_primary ? <Badge variant="soft">Primary</Badge> : <span className="text-muted-foreground">Alias</span>}</TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        {!d.is_primary && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={makePrimary.isPending}
                            onClick={() => makePrimary.mutate(d.id, { onSuccess: () => toast.success(`${d.host} is now primary.`), onError: (e) => toast.error(e.message) })}
                          >
                            <StarIcon data-icon="inline-start" /> Make primary
                          </Button>
                        )}
                        <Button variant="ghost" size="icon-sm" aria-label={`Remove ${d.host}`} onClick={() => setRemoving(d)}><Trash2Icon /></Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {canManage && (
          <form onSubmit={onAdd} noValidate className="flex flex-wrap items-start gap-2">
            <FormField label="New domain" error={error} hint="Host name only, e.g. shop.example.com" className="min-w-64 flex-1">
              <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="shop.example.com" autoCapitalize="none" spellCheck={false} />
            </FormField>
            <Button type="submit" variant="outline" className="mt-6" disabled={add.isPending || !host.trim()}>
              {add.isPending ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : <PlusIcon data-icon="inline-start" />}
              Add domain
            </Button>
          </form>
        )}

        <ConfirmDialog
          open={removing !== null}
          onOpenChange={(open) => !open && setRemoving(null)}
          title={`Remove ${removing?.host}?`}
          description="Visitors to this address will no longer reach the store. An open store keeps at least one domain."
          confirmLabel="Remove"
          pending={remove.isPending}
          onConfirm={() =>
            removing &&
            remove.mutate(removing.id, {
              onSuccess: () => toast.success(`${removing.host} removed.`),
              onError: (e) => toast.error(e.message),
              onSettled: () => setRemoving(null),
            })
          }
        />
      </CardContent>
    </Card>
  )
}

export function StorefrontSettingsPage() {
  const can = useCan()
  const canManage = can('storefront.manage')
  const settings = useStorefrontSettingsQuery()
  const domains = useStorefrontDomainsQuery()

  return (
    <div className="flex flex-col gap-6">
      <StorefrontHeader />
      {settings.isPending || domains.isPending ? (
        <LoadingState rows={4} label="Loading store settings" />
      ) : settings.error || domains.error ? (
        <ErrorState error={settings.error ?? domains.error} onRetry={() => void Promise.all([settings.refetch(), domains.refetch()])} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="flex flex-col gap-6">
            <StatusCard settings={settings.data} primary={domains.data.find((d) => d.is_primary)} canManage={canManage} />
            <DetailsCard settings={settings.data} canManage={canManage} />
            <AvailabilityCard settings={settings.data} canManage={canManage} />
          </div>
          <DomainsCard domains={domains.data} canManage={canManage} />
        </div>
      )}
    </div>
  )
}
