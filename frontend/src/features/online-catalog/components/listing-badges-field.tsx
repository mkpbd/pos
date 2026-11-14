import { Controller, useFieldArray, useWatch, type Control, type FieldErrors, type UseFormRegister } from 'react-hook-form'
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { FormField } from '@/components/common/form-field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAuth, useCan } from '@/features/auth/use-auth'
import { BADGE_TONES, useStoreThemeColorsQuery, type BadgeTone } from '@/features/online-catalog/api'
import { BADGE_TEXT_MAX, counter, MAX_BADGES, newBadge, type ListingFormValues } from '@/features/online-catalog/listing-form'
import { BanglaInput } from '@/features/translations/components/bangla-translations'
import { cn } from '@/lib/utils'
import { badgeColors } from '@/storefront/catalog/badge-colors'
import type { ThemeColors } from '@/storefront/types'

/** Each tone is drawn in a theme colour (the store's mapping); the names match the Theme page's colours. */
const BADGE_TONE_LABELS: Record<BadgeTone, string> = {
  sale: 'Sale colour',
  new: 'Highlight colour',
  info: 'Secondary colour',
  dark: 'Heading colour (dark)',
}

/**
 * The badge as shoppers see it: the store's colours for the tone with the text colour it picks for
 * readability (decorative here: the inputs carry the text).
 */
function BadgePreview({ text, tone, colors }: { text: string; tone: BadgeTone; colors: ThemeColors | null }) {
  return (
    <span aria-hidden data-testid="badge-preview" className={cn('inline-flex max-w-full items-center truncate rounded-full px-2.5 py-0.5 text-xs font-bold', !text.trim() && 'opacity-60')} style={badgeColors(colors, tone)}>
      {text.trim() || 'Badge text'}
    </span>
  )
}

type Props = {
  control: Control<ListingFormValues>
  register: UseFormRegister<ListingFormValues>
  errors: FieldErrors<ListingFormValues>['badges']
  canManage: boolean
  disabled: boolean
}

/** P1b: up to two custom badges with a colour and their Bangla text. */
export function ListingBadgesField({ control, register, errors, canManage, disabled }: Props) {
  const rows = useFieldArray({ control, name: 'badges' })
  const values = useWatch({ control, name: 'badges' }) ?? []
  const listError = errors?.message ?? errors?.root?.message
  // The live theme's colours when this person may read the theme; else the store's default colours.
  const can = useCan()
  const organization = useAuth().organization
  const theme = useStoreThemeColorsQuery(!!organization && can('storefront.view'))
  const colors = (theme.data as ThemeColors | undefined) ?? null

  return (
    <div className="flex flex-col gap-3" data-testid="listing-badges">
      <p className="text-sm text-muted-foreground">
        Up to {MAX_BADGES} short labels such as “Free gift” or “Handmade”, shown on the product’s photos and cards next to the automatic Sale, New and Sold out badges.
        Each colour comes from your theme; the text colour is chosen so it stays easy to read.
      </p>
      {rows.fields.length === 0 && <p className="text-sm text-muted-foreground">No badges.</p>}
      {rows.fields.length > 0 && (
        <ol className="flex flex-col gap-3" aria-label="Badges">
          {rows.fields.map((row, i) => {
            const value = values[i]
            const text = value?.text ?? ''
            const rowErrors = errors?.[i]
            return (
              <li key={row.id} className="flex flex-col gap-3 rounded-md border p-3" aria-label={`Badge ${i + 1}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="text-sm font-medium">Badge {i + 1}</span>
                    <BadgePreview text={text} tone={value?.tone ?? row.tone} colors={colors} />
                  </div>
                  {canManage && (
                    <div className="flex">
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move badge ${i + 1} up`} disabled={i === 0} onClick={() => rows.move(i, i - 1)}><ArrowUpIcon /></Button>
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move badge ${i + 1} down`} disabled={i === rows.fields.length - 1} onClick={() => rows.move(i, i + 1)}><ArrowDownIcon /></Button>
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove badge ${i + 1}`} onClick={() => rows.remove(i)}><Trash2Icon /></Button>
                    </div>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,13rem)]">
                  <FormField label={`Badge ${i + 1} text`} error={rowErrors?.text?.message} hint={counter(text, BADGE_TEXT_MAX)}>
                    <Input maxLength={BADGE_TEXT_MAX} placeholder="e.g. Free gift" {...register(`badges.${i}.text`)} />
                  </FormField>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`badge-${row.id}-tone`}>Badge {i + 1} colour</Label>
                    <Controller control={control} name={`badges.${i}.tone`} render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange} disabled={disabled}>
                        <SelectTrigger id={`badge-${row.id}-tone`} className="w-full" aria-invalid={rowErrors?.tone ? true : undefined}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {BADGE_TONES.map((tone) => (
                            <SelectItem key={tone} value={tone}>
                              <span aria-hidden className="size-3 rounded-full border border-black/10" style={{ background: badgeColors(colors, tone).backgroundColor }} /> {BADGE_TONE_LABELS[tone]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )} />
                    {rowErrors?.tone?.message && <p className="text-sm text-destructive">{rowErrors.tone.message}</p>}
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs text-muted-foreground">
                    In <span lang="bn">বাংলা</span> (Bangla) — empty shows the English text.
                  </span>
                  <Controller control={control} name={`badges.${i}.translations.bn.text`} render={({ field }) => (
                    <BanglaInput label={`Badge ${i + 1} text in Bangla`} base={text} value={field.value ?? ''} onChange={field.onChange} max={BADGE_TEXT_MAX} error={rowErrors?.translations?.bn?.text?.message} disabled={disabled} />
                  )} />
                </div>
              </li>
            )
          })}
        </ol>
      )}
      {listError && <p className="text-sm text-destructive">{listError}</p>}
      {canManage && rows.fields.length < MAX_BADGES && (
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => rows.append(newBadge(values))}>
          <PlusIcon data-icon="inline-start" /> Add badge
        </Button>
      )}
    </div>
  )
}
