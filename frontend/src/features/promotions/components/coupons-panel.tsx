import { useState } from 'react'
import { CopyIcon, Loader2Icon, PencilIcon, PlusIcon, SearchIcon, SparklesIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { FormField } from '@/components/common/form-field'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import {
  useCouponsQuery,
  useCreateCouponsMutation,
  useDeleteCouponMutation,
  useUpdateCouponMutation,
  type Coupon,
  type Promotion,
} from '@/features/promotions/api'
import { couponCodeError, generateError, isInUse, MAX_GENERATE, normalizeCode, promotionErrorMap } from '@/features/promotions/promotions'
import { useDebouncedValue } from '@/lib/use-debounced-value'

/** Shows freshly generated codes so they can be copied in one go. */
function GeneratedCodesDialog({ codes, onClose }: { codes: string[]; onClose: () => void }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'))
      toast.success(codes.length === 1 ? 'Code copied.' : `${codes.length} codes copied.`)
    } catch {
      toast.error('Copying failed. Select the codes and copy them by hand.')
    }
  }

  return (
    <Dialog open={codes.length > 0} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{codes.length === 1 ? '1 code generated' : `${codes.length} codes generated`}</DialogTitle>
          <DialogDescription>Hand them out or paste them into your campaign. They stay listed on this tab.</DialogDescription>
        </DialogHeader>
        <Textarea readOnly aria-label="Generated codes" rows={Math.min(12, Math.max(3, codes.length))} className="font-mono" value={codes.join('\n')} onFocus={(e) => e.currentTarget.select()} />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Done</Button>
          <Button type="button" onClick={() => void copy()}><CopyIcon data-icon="inline-start" /> Copy all</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function UsageLimitDialog({ promotionId, coupon, onClose }: { promotionId: string; coupon: Coupon | null; onClose: () => void }) {
  const update = useUpdateCouponMutation(promotionId)
  const [value, setValue] = useState(coupon?.usage_limit == null ? '' : String(coupon.usage_limit))
  const [error, setError] = useState<string>()

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!coupon) return
    const trimmed = value.trim()
    if (trimmed && (!/^\d{1,9}$/.test(trimmed) || Number(trimmed) < 1)) return setError('A whole number of at least 1, or empty for no limit.')
    update.mutate(
      { id: coupon.id, input: { usage_limit: trimmed ? Number(trimmed) : null } },
      {
        onSuccess: () => {
          toast.success(`Limit of ${coupon.code} saved.`)
          onClose()
        },
        onError: (err) => setError(promotionErrorMap(err).usage_limit ?? promotionErrorMap(err).form),
      },
    )
  }

  return (
    <Dialog open={coupon !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form noValidate onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Usage limit of {coupon?.code}</DialogTitle>
            <DialogDescription>How many orders may use this code in total. Used {coupon?.used_count ?? 0} times so far.</DialogDescription>
          </DialogHeader>
          <FormField label="Uses allowed" error={error} hint="Empty: no limit for this code (the offer's own limits still apply).">
            <Input inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={update.isPending}>{update.isPending && <Loader2Icon className="animate-spin" data-icon="inline-start" />} Save limit</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function AddCodes({ promotionId, onGenerated }: { promotionId: string; onGenerated: (codes: string[]) => void }) {
  const create = useCreateCouponsMutation(promotionId)
  const [code, setCode] = useState('')
  const [count, setCount] = useState('10')
  const [prefix, setPrefix] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [pending, setPending] = useState<'code' | 'generate' | null>(null)

  const addCode = (e: React.FormEvent) => {
    e.preventDefault()
    const normalized = normalizeCode(code)
    const error = couponCodeError(normalized)
    if (error) return setErrors({ code: error })
    setErrors({})
    setPending('code')
    create.mutate(
      { code: normalized },
      {
        onSuccess: () => {
          toast.success(`Code ${normalized} added.`)
          setCode('')
        },
        onError: (err) => {
          const map = promotionErrorMap(err)
          setErrors({ code: map.code ?? map.form ?? 'Something went wrong.' })
        },
        onSettled: () => setPending(null),
      },
    )
  }

  const generate = (e: React.FormEvent) => {
    e.preventDefault()
    const normalizedPrefix = normalizeCode(prefix)
    const local = generateError(count, normalizedPrefix)
    if (Object.keys(local).length > 0) return setErrors(local)
    setErrors({})
    setPending('generate')
    create.mutate(
      { generate: Number(count.trim()), ...(normalizedPrefix ? { prefix: normalizedPrefix } : {}) },
      {
        onSuccess: (coupons) => onGenerated(coupons.map((c) => c.code)),
        onError: (err) => {
          const map = promotionErrorMap(err)
          setErrors({ generate: map.generate ?? map.form ?? '', ...(map.prefix ? { prefix: map.prefix } : {}) })
        },
        onSettled: () => setPending(null),
      },
    )
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form noValidate onSubmit={addCode} className="flex flex-col gap-3 rounded-md border p-3" aria-label="Add a code">
        <FormField label="New code" error={errors.code} hint="Letters, digits and hyphens, e.g. WELCOME50.">
          <Input value={code} maxLength={40} spellCheck={false} autoCapitalize="characters" className="font-mono uppercase" onChange={(e) => setCode(e.target.value.toUpperCase())} />
        </FormField>
        <Button type="submit" variant="outline" className="self-start" disabled={pending !== null}>
          {pending === 'code' ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <PlusIcon data-icon="inline-start" />} Add code
        </Button>
      </form>
      <form noValidate onSubmit={generate} className="flex flex-col gap-3 rounded-md border p-3" aria-label="Generate codes">
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="How many codes" error={errors.generate} hint={`Up to ${MAX_GENERATE} at a time.`}>
            <Input inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} />
          </FormField>
          <FormField label="Prefix (optional)" error={errors.prefix} hint="e.g. EID- gives EID-7K2M9Q.">
            <Input value={prefix} maxLength={20} spellCheck={false} className="font-mono uppercase" onChange={(e) => setPrefix(e.target.value.toUpperCase())} />
          </FormField>
        </div>
        <Button type="submit" variant="outline" className="self-start" disabled={pending !== null}>
          {pending === 'generate' ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <SparklesIcon data-icon="inline-start" />} Generate codes
        </Button>
      </form>
    </div>
  )
}

/** Codes of a coupon promotion: add, generate, switch off, limit and delete unused ones. */
export function CouponsPanel({ promotion, canManage }: { promotion: Promotion; canManage: boolean }) {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const term = useDebouncedValue(search.trim().toUpperCase(), 300)
  const coupons = useCouponsQuery(promotion.id, { page, search: term || undefined })
  const update = useUpdateCouponMutation(promotion.id)
  const remove = useDeleteCouponMutation(promotion.id)
  const [generated, setGenerated] = useState<string[]>([])
  const [limitOf, setLimitOf] = useState<Coupon | null>(null)
  const [deleting, setDeleting] = useState<Coupon | null>(null)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Coupon codes</CardTitle>
        <CardDescription>Shoppers enter one of these codes in the cart to get this offer. One code per cart.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {canManage && <AddCodes promotionId={promotion.id} onGenerated={setGenerated} />}

        <div className="relative max-w-sm">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search codes"
            aria-label="Search codes"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
          />
        </div>

        {coupons.isPending ? (
          <LoadingState label="Loading codes" />
        ) : coupons.error ? (
          <ErrorState error={coupons.error} onRetry={() => coupons.refetch()} />
        ) : coupons.data.items.length === 0 ? (
          <EmptyState title={term ? 'No matching codes' : 'No codes yet'} description={term ? undefined : 'Add a code or generate a batch; the offer cannot be used without one.'} />
        ) : (
          <>
            <div className="overflow-x-auto rounded-md border">
              <Table aria-label="Coupon codes">
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead className="text-right">Used</TableHead>
                    <TableHead>Limit</TableHead>
                    <TableHead>Status</TableHead>
                    {canManage && <TableHead><span className="sr-only">Actions</span></TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {coupons.data.items.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono">{c.code}</TableCell>
                      <TableCell className="text-right">{c.used_count}</TableCell>
                      <TableCell className="text-sm">{c.usage_limit ?? 'No limit'}</TableCell>
                      <TableCell>
                        {canManage ? (
                          <Switch
                            aria-label={`${c.code} active`}
                            checked={c.is_active}
                            disabled={update.isPending}
                            onCheckedChange={(is_active) =>
                              update.mutate({ id: c.id, input: { is_active } }, { onSuccess: () => toast.success(`${c.code} ${is_active ? 'activated' : 'deactivated'}.`), onError: (e) => toast.error(e.message) })
                            }
                          />
                        ) : (
                          <Badge variant={c.is_active ? 'success' : 'outline'}>{c.is_active ? 'Active' : 'Off'}</Badge>
                        )}
                      </TableCell>
                      {canManage && (
                        <TableCell className="text-right whitespace-nowrap">
                          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Edit limit of ${c.code}`} onClick={() => setLimitOf(c)}><PencilIcon /></Button>
                          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Delete ${c.code}`} disabled={c.used_count > 0} title={c.used_count > 0 ? 'Used codes cannot be deleted; switch them off instead.' : undefined} onClick={() => setDeleting(c)}><Trash2Icon /></Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <PaginationBar pagination={coupons.data.pagination} onPageChange={setPage} />
          </>
        )}
      </CardContent>

      <GeneratedCodesDialog codes={generated} onClose={() => setGenerated([])} />
      {limitOf && <UsageLimitDialog key={limitOf.id} promotionId={promotion.id} coupon={limitOf} onClose={() => setLimitOf(null)} />}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.code ?? 'this code'}?`}
        description="Shoppers can no longer use it. Codes that were used stay for the record; switch those off instead."
        confirmLabel="Delete code"
        pending={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => {
              toast.success(`${deleting.code} deleted.`)
              setDeleting(null)
            },
            onError: (error) => {
              setDeleting(null)
              toast.error(isInUse(error) ? `${deleting.code} has been used, so it cannot be deleted. Switch it off instead.` : error.message)
            },
          })
        }
      />
    </Card>
  )
}
