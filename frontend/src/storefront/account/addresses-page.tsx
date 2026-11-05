import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { PencilIcon, PlusIcon, StarIcon, Trash2Icon } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { applyServerErrors, storeFormError } from '../form-errors'
import { useLocale } from '../i18n/locale'
import type { AddressInput, CustomerAddress, GeoId } from '../types'
import { privatePage, useDocumentMeta } from '../use-document-meta'
import { AccountShell } from './account-pages'
import { MAX_ADDRESSES, useAddressesQuery, useDeleteAddressMutation, useDistrictsQuery, useDivisionsQuery, useSaveAddressMutation } from './api'
import { FormAlert, Spinner, SubmitButton, TextField, inputClass, primaryButtonClass, secondaryButtonClass } from './form-controls'
import { addressSchema, normalizeBdPhone, type AddressValues } from './schemas'

type Editing = { mode: 'new' } | { mode: 'edit'; address: CustomerAddress } | null

export function AddressesPage() {
  const { t } = useLocale()
  useDocumentMeta(privatePage(t('account.addresses.title')))
  const addresses = useAddressesQuery()
  const [editing, setEditing] = useState<Editing>(null)
  const [deleting, setDeleting] = useState<CustomerAddress | null>(null)
  const save = useSaveAddressMutation()
  const remove = useDeleteAddressMutation()
  const [listError, setListError] = useState<string | null>(null)
  const list = addresses.data ?? []
  const full = list.length >= MAX_ADDRESSES

  const makeDefault = (address: CustomerAddress) => {
    setListError(null)
    save.mutate({ id: address.id, input: { is_default_shipping: true } }, { onError: (error) => setListError(storeFormError(error, t)) })
  }

  return (
    <AccountShell title={t('account.addresses.title')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">{t('account.addresses.intro', { max: MAX_ADDRESSES })}</p>
        <button type="button" className={primaryButtonClass} disabled={!addresses.data || full} onClick={() => setEditing({ mode: 'new' })}>
          <PlusIcon aria-hidden className="size-4" />
          {t('account.addresses.add')}
        </button>
      </div>
      {full && <p className="mt-2 text-sm">{t('account.addresses.full', { max: MAX_ADDRESSES })}</p>}
      <FormAlert message={listError} />

      {addresses.error ? (
        <div className="mt-6 rounded-sf-card bg-sf-surface p-6">
          <p role="alert">{storeFormError(addresses.error, t)}</p>
          <button type="button" className={`${primaryButtonClass} mt-3`} onClick={() => void addresses.refetch()}>{t('common.tryAgain')}</button>
        </div>
      ) : !addresses.data ? (
        <Spinner label={t('account.addresses.loading')} />
      ) : list.length === 0 ? (
        <div className="mt-6 rounded-sf-card bg-sf-surface p-8 text-center">
          <p className="font-semibold text-sf-heading">{t('account.addresses.empty')}</p>
        </div>
      ) : (
        <ul className="mt-6 grid gap-4 md:grid-cols-2" aria-label={t('account.addresses.listLabel')}>
          {list.map((address) => (
            <li key={address.id} className={cn('flex flex-col gap-3 rounded-sf-card border-2 bg-sf-surface p-5', address.is_default_shipping ? 'border-sf-accent' : 'border-transparent')} data-testid="address-card">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-heading text-lg font-bold">{address.label || address.recipient_name}</h2>
                {address.is_default_shipping && <span className="rounded-full bg-sf-accent px-2.5 py-0.5 text-xs font-bold text-sf-accent-foreground">{t('account.addresses.default')}</span>}
                {address.is_default_billing && <span className="rounded-full bg-sf-canvas px-2.5 py-0.5 text-xs font-bold text-sf-heading">{t('account.addresses.billing')}</span>}
              </div>
              <address className="text-sm leading-relaxed not-italic">
                {address.recipient_name}
                <br />
                {address.address_line}
                <br />
                {address.area}, {address.district.name}
                {address.postcode ? ` ${address.postcode}` : ''}
                <br />
                {address.division.name}
                <br />
                {address.phone}
              </address>
              <div className="mt-auto flex flex-wrap gap-2">
                <button type="button" className={secondaryButtonClass} onClick={() => setEditing({ mode: 'edit', address })} aria-label={t('account.addresses.editAria', { name: address.label || address.recipient_name })}>
                  <PencilIcon aria-hidden className="size-4" />
                  {t('account.addresses.edit')}
                </button>
                {!address.is_default_shipping && (
                  <button type="button" className={secondaryButtonClass} disabled={save.isPending} onClick={() => makeDefault(address)} aria-label={t('account.addresses.makeDefaultAria', { name: address.label || address.recipient_name })}>
                    <StarIcon aria-hidden className="size-4" />
                    {t('account.addresses.makeDefault')}
                  </button>
                )}
                <button type="button" className={cn(secondaryButtonClass, 'hover:border-sf-sale hover:text-sf-sale')} onClick={() => setDeleting(address)} aria-label={t('account.addresses.deleteAria', { name: address.label || address.recipient_name })}>
                  <Trash2Icon aria-hidden className="size-4" />
                  {t('account.addresses.delete')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto bg-sf-surface p-5 sm:max-w-xl md:p-6">
          {editing && (
            <AddressForm
              key={editing.mode === 'edit' ? editing.address.id : 'new'}
              address={editing.mode === 'edit' ? editing.address : null}
              isFirst={list.length === 0}
              onDone={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent className="bg-sf-surface">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('account.addresses.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting ? `${deleting.label || deleting.recipient_name}: ${deleting.address_line}, ${deleting.area}, ${deleting.district.name}.` : ''}
              {deleting?.is_default_shipping ? ` ${t('account.addresses.deleteDefaultNote')}` : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('account.addresses.keep')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-sf-sale text-white hover:bg-sf-sale/90"
              onClick={() => {
                if (!deleting) return
                setListError(null)
                remove.mutate(deleting.id, { onError: (error) => setListError(storeFormError(error, t)) })
              }}
            >
              {t('account.addresses.deleteConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AccountShell>
  )
}

const selectClass = cn(inputClass, 'appearance-auto')

function toValues(address: CustomerAddress | null, isFirst: boolean): AddressValues {
  return {
    label: address?.label ?? '',
    recipient_name: address?.recipient_name ?? '',
    phone: address?.phone ?? '',
    division_id: address ? String(address.division.id) : '',
    district_id: address ? String(address.district.id) : '',
    area: address?.area ?? '',
    address_line: address?.address_line ?? '',
    postcode: address?.postcode ?? '',
    is_default_shipping: address ? address.is_default_shipping : isFirst,
    is_default_billing: address ? address.is_default_billing : isFirst,
  }
}

const FIELDS = ['label', 'recipient_name', 'phone', 'division_id', 'district_id', 'area', 'address_line', 'postcode'] as const

function AddressForm({ address, isFirst, onDone }: { address: CustomerAddress | null; isFirst: boolean; onDone: () => void }) {
  const save = useSaveAddressMutation()
  const { t, locale, translateMessage } = useLocale()
  const divisions = useDivisionsQuery()
  const [formError, setFormError] = useState<string | null>(null)
  const form = useForm<AddressValues>({ resolver: zodResolver(addressSchema), defaultValues: toValues(address, isFirst) })
  const { errors } = form.formState
  const divisionId = useWatch({ control: form.control, name: 'division_id' })
  // Controlled: the saved choice shows once the options have loaded.
  const districtId = useWatch({ control: form.control, name: 'district_id' })
  const districts = useDistrictsQuery(divisionId)

  // Ids go back to the server exactly as it sent them (number or string).
  const originalId = (list: { id: GeoId }[] | undefined, value: string): GeoId => list?.find((item) => String(item.id) === value)?.id ?? value

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null)
    const input: AddressInput = {
      label: values.label.trim() || null,
      recipient_name: values.recipient_name.trim(),
      phone: normalizeBdPhone(values.phone.trim()),
      division_id: originalId(divisions.data, values.division_id),
      district_id: originalId(districts.data, values.district_id),
      area: values.area.trim(),
      address_line: values.address_line.trim(),
      postcode: values.postcode.trim() || null,
      is_default_shipping: values.is_default_shipping,
      is_default_billing: values.is_default_billing,
    }
    save.mutate(
      { id: address?.id, input },
      {
        onSuccess: onDone,
        onError: (error) => {
          if (!applyServerErrors(error, form.setError, FIELDS)) setFormError(storeFormError(error, t))
        },
      },
    )
  })

  const divisionField = form.register('division_id', { onChange: () => form.setValue('district_id', '') })
  const select = (name: 'division_id' | 'district_id', label: string, value: string, options: { id: GeoId; name: string; name_bn: string | null }[] | undefined, placeholder: string, registered: ReturnType<typeof form.register>, disabled: boolean) => (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`address-${name}`} className="text-sm font-medium text-sf-heading">{label}</label>
      <select
        id={`address-${name}`}
        className={selectClass}
        disabled={disabled}
        aria-invalid={errors[name] ? true : undefined}
        aria-describedby={errors[name] ? `address-${name}-error` : undefined}
        {...registered}
        value={value}
      >
        <option value="">{placeholder}</option>
        {options?.map((option) => (
          <option key={String(option.id)} value={String(option.id)}>
            {/* In Bangla the API already names the place in Bangla; English adds the Bangla name. */}
            {locale === 'bn' ? (option.name_bn ?? option.name) : option.name}
            {locale !== 'bn' && option.name_bn ? ` (${option.name_bn})` : ''}
          </option>
        ))}
      </select>
      {errors[name] && <p id={`address-${name}-error`} className="text-sm text-sf-sale">{translateMessage(errors[name]?.message ?? '')}</p>}
    </div>
  )

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4" aria-label={address ? t('account.addressForm.editTitle') : t('account.addressForm.addTitle')}>
      <DialogTitle className="pr-8 font-heading text-2xl font-extrabold text-sf-heading">
        {address ? t('account.addressForm.editTitle') : t('account.addressForm.addTitle')}
      </DialogTitle>
      <DialogDescription>{t('account.addressForm.description')}</DialogDescription>
      <FormAlert message={formError} />
      {divisions.isError && <FormAlert message={t('account.addressForm.divisionsFailed')} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label={t('account.addressForm.label')} placeholder={t('account.addressForm.labelPlaceholder')} maxLength={40} error={errors.label?.message} {...form.register('label')} />
        <TextField label={t('account.addressForm.recipient')} autoComplete="name" maxLength={120} error={errors.recipient_name?.message} {...form.register('recipient_name')} />
        <TextField label={t('account.addressForm.mobile')} type="tel" autoComplete="tel" placeholder="01XXXXXXXXX" maxLength={20} error={errors.phone?.message} className="sm:col-span-2" {...form.register('phone')} />
        {select('division_id', t('account.addressForm.division'), divisionId, divisions.data, divisions.isPending ? t('common.loading') : t('account.addressForm.chooseDivision'), divisionField, !divisions.data)}
        {select(
          'district_id',
          t('account.addressForm.district'),
          districtId,
          divisionId ? districts.data : [],
          divisionId ? (districts.isPending ? t('common.loading') : t('account.addressForm.chooseDistrict')) : t('account.addressForm.chooseDivisionFirst'),
          form.register('district_id'),
          !divisionId || !districts.data,
        )}
        <TextField label={t('account.addressForm.area')} maxLength={100} error={errors.area?.message} {...form.register('area')} />
        <TextField label={t('account.addressForm.postcode')} inputMode="numeric" autoComplete="postal-code" maxLength={4} error={errors.postcode?.message} {...form.register('postcode')} />
        <TextField label={t('account.addressForm.street')} autoComplete="street-address" maxLength={255} placeholder={t('account.addressForm.streetPlaceholder')} error={errors.address_line?.message} className="sm:col-span-2" {...form.register('address_line')} />
      </div>
      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="sr-only">{t('account.addressForm.defaults')}</legend>
        {address?.is_default_shipping ? (
          <p>{t('account.addressForm.isDefault')}</p>
        ) : (
          <label className="flex items-center gap-2">
            <input type="checkbox" className="size-4 accent-sf-accent" {...form.register('is_default_shipping')} />
            {t('account.addressForm.defaultDelivery')}
          </label>
        )}
        <label className="flex items-center gap-2">
          <input type="checkbox" className="size-4 accent-sf-accent" {...form.register('is_default_billing')} />
          {t('account.addressForm.defaultBilling')}
        </label>
      </fieldset>
      <div className="flex flex-wrap gap-3">
        <SubmitButton pending={save.isPending} pendingLabel={t('account.saving')}>{address ? t('account.addressForm.save') : t('account.addresses.add')}</SubmitButton>
        <button type="button" className={secondaryButtonClass} onClick={onDone}>{t('common.cancel')}</button>
      </div>
    </form>
  )
}
