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
  useSetDomainEntryPathMutation,
  useStorefrontDomainsQuery,
  useStorefrontSettingsQuery,
  type StoreLocale,
  type StorefrontDomain,
  type StorefrontSettings,
} from '@/features/storefront/api'
import { SharingCard } from '@/features/storefront/components/sharing-card'
import { StorefrontHeader } from '@/features/storefront/components/storefront-header'
import { documentPath, useDocumentsQuery } from '@/features/store-builder/api'
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

function SearchEnginesCard({ settings, canManage }: { settings: StorefrontSettings; canManage: boolean }) {
  const save = useSaveStorefrontSettingsMutation()
  const allowed = settings.allow_indexing ?? true

  const toggle = (on: boolean) =>
    save.mutate(
      { allow_indexing: on },
      {
        onSuccess: (s) => toast.success((s.allow_indexing ?? on) ? 'Search engines may index the store.' : 'Search engines are asked not to index the store.'),
        onError: (e) => toast.error(e.message),
      },
    )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Search engines</CardTitle>
        <CardDescription>Whether the store may appear in Google and other search results.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Switch id="allow-indexing" checked={allowed} disabled={!canManage || save.isPending} onCheckedChange={toggle} aria-describedby="allow-indexing-help" />
          <Label htmlFor="allow-indexing">Allow search engines to index the store</Label>
        </div>
        <p id="allow-indexing-help" className="text-sm text-muted-foreground">
          Turn this off for a staging or test store: robots.txt then disallows everything and every page is marked noindex. Pages already in search results drop out over time.
        </p>
      </CardContent>
    </Card>
  )
}

const LOCALE_LABELS: Record<StoreLocale, string> = { en: 'English', bn: 'বাংলা (Bangla)' }

/** Store languages (E12b): whether shoppers may switch to Bangla, the first language, and Bengali digits. */
function LanguagesCard({ settings, canManage }: { settings: StorefrontSettings; canManage: boolean }) {
  const save = useSaveStorefrontSettingsMutation()
  const [error, setError] = useState<string | undefined>()
  const banglaEnabled = settings.bangla_enabled ?? true
  const defaultLocale: StoreLocale = banglaEnabled ? (settings.default_locale ?? 'en') : 'en'
  const banglaDigits = settings.bangla_digits ?? false
  const busy = !canManage || save.isPending

  const update = (input: Parameters<typeof save.mutate>[0], done: (s: StorefrontSettings) => string) => {
    setError(undefined)
    save.mutate(input, {
      onSuccess: (s) => toast.success(done(s)),
      onError: (e) => {
        const map = fieldErrorMap(e)
        const message = map.default_locale ?? map.bangla_enabled ?? map.bangla_digits ?? map.form ?? e.message
        setError(message)
      },
    })
  }

  const toggleBangla = (on: boolean) =>
    // Bangla can only be the default language while it is enabled.
    update(on ? { bangla_enabled: true } : { bangla_enabled: false, ...(defaultLocale === 'bn' ? { default_locale: 'en' as const } : {}) }, (s) =>
      (s.bangla_enabled ?? on) ? 'Shoppers can switch the store to Bangla.' : 'The store is shown in English only.',
    )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Languages</CardTitle>
        <CardDescription>
          The store is available in English and <span lang="bn">বাংলা</span>. Bangla texts come from the “বাংলা (Bangla)” section of each editor; anything not translated is shown in English.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Switch id="bangla-enabled" checked={banglaEnabled} disabled={busy} onCheckedChange={toggleBangla} aria-describedby="bangla-enabled-help" />
            <Label htmlFor="bangla-enabled">Offer the store in Bangla</Label>
          </div>
          <p id="bangla-enabled-help" className="text-sm text-muted-foreground">Shows the English / বাংলা switch in the store header and lists both languages to search engines.</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="default-locale">Default language</Label>
          <Select
            value={defaultLocale}
            disabled={busy}
            onValueChange={(v) => update({ default_locale: v as StoreLocale }, (s) => `Visitors see the store in ${LOCALE_LABELS[s.default_locale ?? (v as StoreLocale)]} first.`)}
          >
            <SelectTrigger id="default-locale" className="w-full sm:w-64" aria-describedby="default-locale-help" aria-invalid={error ? true : undefined}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="en">{LOCALE_LABELS.en}</SelectItem>
              <SelectItem value="bn" disabled={!banglaEnabled}>{LOCALE_LABELS.bn}</SelectItem>
            </SelectContent>
          </Select>
          <p id="default-locale-help" className="text-sm text-muted-foreground">
            {banglaEnabled ? 'For visitors who have not picked a language yet.' : 'Turn on Bangla to make it the default language.'}
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Switch
              id="bangla-digits"
              checked={banglaDigits}
              disabled={busy || !banglaEnabled}
              aria-describedby="bangla-digits-help"
              onCheckedChange={(on) => update({ bangla_digits: on }, (s) => ((s.bangla_digits ?? on) ? 'Bangla pages show Bengali digits.' : 'Bangla pages show Latin digits.'))}
            />
            <Label htmlFor="bangla-digits">Bengali digits in Bangla</Label>
          </div>
          <p id="bangla-digits-help" className="text-sm text-muted-foreground">
            Prices and numbers on Bangla pages as <span lang="bn">৳১,২৫০.০০</span> instead of ৳1,250.00. English pages always use 0–9.
          </p>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  )
}

function CheckoutCard({ settings, canManage }: { settings: StorefrontSettings; canManage: boolean }) {
  const save = useSaveStorefrontSettingsMutation()
  const allowed = settings.guest_checkout_enabled ?? true

  const toggle = (on: boolean) =>
    save.mutate(
      { guest_checkout_enabled: on },
      {
        onSuccess: (s) => toast.success((s.guest_checkout_enabled ?? on) ? 'Guests can check out without an account.' : 'Customers must sign in to check out.'),
        onError: (e) => toast.error(e.message),
      },
    )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Checkout</CardTitle>
        <CardDescription>Guests give their name, e-mail and phone at checkout instead of creating an account.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Switch id="guest-checkout" checked={allowed} disabled={!canManage || save.isPending} onCheckedChange={toggle} />
          <Label htmlFor="guest-checkout">Allow guest checkout</Label>
        </div>
        {/* Keyed by the saved value, so the field resets when the setting changes. */}
        <ReturnWindowForm key={settings.return_window_days ?? 7} settings={settings} canManage={canManage} />
      </CardContent>
    </Card>
  )
}

/** Days after delivery in which signed-in customers may request a return; 0 turns customer returns off. */
function ReturnWindowForm({ settings, canManage }: { settings: StorefrontSettings; canManage: boolean }) {
  const save = useSaveStorefrontSettingsMutation()
  const current = String(settings.return_window_days ?? 7)
  const [value, setValue] = useState(current)
  const [error, setError] = useState<string | null>(null)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const days = Number(value)
    if (!/^\d{1,2}$/.test(value.trim()) || days > 60) {
      setError('Enter a whole number of days from 0 to 60.')
      return
    }
    setError(null)
    save.mutate(
      { return_window_days: days },
      {
        onSuccess: (s) => toast.success((s.return_window_days ?? days) === 0 ? 'Customers can no longer request returns online.' : `Customers can request returns for ${s.return_window_days ?? days} days after delivery.`),
        onError: (err) => setError(fieldErrorMap(err).return_window_days ?? err.message),
      },
    )
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-3">
      <FormField label="Return window (days)" error={error ?? undefined} hint="Counted from delivery; 0 turns customer returns off. Staff can still accept a return later." className="w-56">
        <Input inputMode="numeric" value={value} disabled={!canManage} onChange={(e) => setValue(e.target.value)} />
      </FormField>
      {canManage && (
        <Button type="submit" variant="outline" disabled={save.isPending || value.trim() === current}>
          Save return window
        </Button>
      )}
    </form>
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

const HOME = '__home__'

/**
 * P2a "Opens on": the page a domain shows at its home address — a campaign page gives a promotion
 * its own address. The rest of the store keeps working on that domain.
 */
function EntryPathCell({ domain, canManage, pages }: { domain: StorefrontDomain; canManage: boolean; pages: { path: string; title: string }[] }) {
  const setEntry = useSetDomainEntryPathMutation()
  const current = domain.entry_path ?? null
  const options = current && !pages.some((p) => p.path === current) ? [...pages, { path: current, title: current }] : pages
  const label = current ? (options.find((p) => p.path === current)?.title ?? current) : 'Home page'

  if (!canManage) {
    return <span className={current ? '' : 'text-muted-foreground'}>{label}{current && <span className="block font-mono text-xs text-muted-foreground">{current}</span>}</span>
  }
  return (
    <Select
      value={current ?? HOME}
      disabled={setEntry.isPending}
      onValueChange={(v) => {
        const entryPath = v === HOME ? null : v
        setEntry.mutate(
          { id: domain.id, entryPath },
          {
            onSuccess: () => toast.success(entryPath ? `${domain.host} now opens on ${entryPath}.` : `${domain.host} now opens on the home page.`),
            onError: (e) => toast.error(fieldErrorMap(e).entry_path ?? e.message),
          },
        )
      }}
    >
      <SelectTrigger className="w-full min-w-40 sm:w-56" aria-label={`Page ${domain.host} opens on`}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={HOME}>Home page</SelectItem>
        {options.map((p) => <SelectItem key={p.path} value={p.path}>{p.title} ({p.path})</SelectItem>)}
      </SelectContent>
    </Select>
  )
}

function DomainsCard({ domains, canManage }: { domains: StorefrontDomain[]; canManage: boolean }) {
  const add = useAddDomainMutation()
  const makePrimary = useMakeDomainPrimaryMutation()
  const remove = useRemoveDomainMutation()
  const [host, setHost] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [removing, setRemoving] = useState<StorefrontDomain | null>(null)
  const documents = useDocumentsQuery()
  // Campaign pages (`/p/<slug>`) that a domain can open on.
  const campaignPages = (documents.data ?? [])
    .filter((d) => d.kind === 'page' && d.key.startsWith('landing:'))
    .map((d) => ({ path: documentPath(d) ?? '', title: d.title || d.key, published: d.published !== null }))
    .filter((p) => p.path !== '')
    .map((p) => ({ path: p.path, title: p.published ? p.title : `${p.title} — not published` }))

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
        <CardDescription>
          Host names that open this store. Point their DNS at your server; the primary domain is used in links and search results. “Opens on” picks the page a
          domain shows first — give a campaign its own address, such as eid-offer.com opening your Eid page. The rest of the store still works there.
        </CardDescription>
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
                  <TableHead>Opens on</TableHead>
                  {canManage && <TableHead className="w-48"><span className="sr-only">Actions</span></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {domains.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.host}</TableCell>
                    <TableCell>{d.is_primary ? <Badge variant="soft">Primary</Badge> : <span className="text-muted-foreground">Alias</span>}</TableCell>
                    <TableCell><EntryPathCell domain={d} canManage={canManage} pages={campaignPages} /></TableCell>
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
            <SearchEnginesCard settings={settings.data} canManage={canManage} />
            <LanguagesCard settings={settings.data} canManage={canManage} />
            <AvailabilityCard settings={settings.data} canManage={canManage} />
            <CheckoutCard settings={settings.data} canManage={canManage} />
            {/* P2b: keyed by the saved number so the field shows the server's form after saving. */}
            <SharingCard key={settings.data.whatsapp_number ?? ''} settings={settings.data} canManage={canManage} />
          </div>
          <DomainsCard domains={domains.data} canManage={canManage} />
        </div>
      )}
    </div>
  )
}
