import { useId, useState } from 'react'
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, Loader2Icon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAttributesQuery } from '@/features/catalog/api'
import { useSaveOptionImagesMutation, type OptionStyle, type Product } from '@/features/products/api'
import {
  defaultStyleLabel,
  MAX_PHOTOS_PER_VALUE,
  movePhoto,
  STYLE_LABELS,
  togglePhoto,
  toOptionImagesInput,
  toOptionPhotosState,
  type OptionPhotosState,
} from '@/features/products/option-photos'
import { ApiError } from '@/lib/api/client'
import { cn } from '@/lib/utils'

const NONE = '__none__'
const AUTO = '__auto__'

/**
 * "Photos by colour" (P1a §1): one option (usually Colour) owns photos — each value gets an
 * ordered pick of the product's images, which the store shows when a shopper chooses it — and
 * every option gets a swatch style (colour circles, photo chips or buttons).
 */
export function OptionPhotosCard({ product }: { product: Product }) {
  const ids = useId()
  const save = useSaveOptionImagesMutation(product.id)
  const attributes = useAttributesQuery()
  const options = product.options ?? []
  const [state, setState] = useState<OptionPhotosState>(() => toOptionPhotosState(product))
  const [baseline, setBaseline] = useState(() => JSON.stringify(toOptionPhotosState(product)))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const dirty = JSON.stringify(state) !== baseline
  const values = options.find((o) => o.name === state.photoOption)?.values ?? []
  const imageIndex = new Map(product.images.map((img, i) => [img.id, i]))

  const choosePhotoOption = (name: string | null) => {
    const saved = toOptionPhotosState(product)
    const optionValues = options.find((o) => o.name === name)?.values ?? []
    setState((s) => ({
      ...s,
      photoOption: name,
      photos: Object.fromEntries(optionValues.map((v) => [v, name === saved.photoOption ? (saved.photos[v] ?? []) : []])),
    }))
  }
  const setPhotos = (value: string, next: string[]) => setState((s) => ({ ...s, photos: { ...s.photos, [value]: next } }))

  const submit = () =>
    save.mutate(toOptionImagesInput(state, product), {
      onSuccess: (saved) => {
        const next = toOptionPhotosState(saved)
        setState(next)
        setBaseline(JSON.stringify(next))
        setErrors({})
        toast.success('Photos by colour saved.')
      },
      onError: (error) => {
        if (error instanceof ApiError && error.code === 'VALIDATION_FAILED') {
          const mapped: Record<string, string> = {}
          for (const [key, messages] of Object.entries(error.fieldErrors)) {
            const valueMatch = /^values\.(\d+)/.exec(key)
            const value = valueMatch ? values[Number(valueMatch[1])] : undefined
            mapped[value !== undefined ? `value:${value}` : key.startsWith('styles.') ? key : 'form'] = messages[0] ?? error.message
          }
          setErrors(mapped)
        } else {
          setErrors({ form: error.message })
        }
      },
    })

  return (
    <Card id="photos-by-colour" role="region" aria-labelledby={`${ids}-title`}>
      <CardHeader>
        <CardTitle id={`${ids}-title`}>Photos by colour</CardTitle>
        <CardDescription>
          When a shopper picks a colour, the store shows that colour’s photos (all photos stay one click away). Choose the option that owns the
          photos, then pick each value’s photos in order — the first one is also its swatch.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${ids}-photo-option`}>Option with its own photos</Label>
            <Select value={state.photoOption ?? NONE} onValueChange={(v) => choosePhotoOption(v === NONE ? null : v)}>
              <SelectTrigger id={`${ids}-photo-option`} className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None — always show all photos</SelectItem>
                {options.map((o) => <SelectItem key={o.name} value={o.name}>{o.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {errors.photo_option && <p className="text-sm text-destructive">{errors.photo_option}</p>}
          </div>
          {options.map((o) => {
            const attribute = (attributes.data ?? []).find((a) => a.name.toLowerCase() === o.name.toLowerCase())
            const error = errors[`styles.${o.name}`]
            return (
              <div key={o.name} className="flex flex-col gap-1.5">
                <Label htmlFor={`${ids}-style-${o.name}`}>How shoppers pick {o.name}</Label>
                <Select value={state.styles[o.name] || AUTO} onValueChange={(v) => setState((s) => ({ ...s, styles: { ...s.styles, [o.name]: v === AUTO ? '' : (v as OptionStyle) } }))}>
                  <SelectTrigger id={`${ids}-style-${o.name}`} className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={AUTO}>Automatic ({defaultStyleLabel(attribute?.display)})</SelectItem>
                    {(Object.keys(STYLE_LABELS) as OptionStyle[]).map((style) => <SelectItem key={style} value={style}>{STYLE_LABELS[style]}</SelectItem>)}
                  </SelectContent>
                </Select>
                {error && <p className="text-sm text-destructive">{error}</p>}
              </div>
            )
          })}
        </div>
        <p className="-mt-2 text-xs text-muted-foreground">Colour circles use the colours set under Catalog → Attributes; photo chips use each value’s first photo.</p>

        {state.photoOption && (
          <ul className="flex flex-col gap-4" aria-label={`Photos per ${state.photoOption}`}>
            {values.map((value) => {
              const chosen = state.photos[value] ?? []
              const error = errors[`value:${value}`]
              return (
                <li key={value} className={cn('flex flex-col gap-2 rounded-md border p-3', error && 'border-destructive/60')}>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">{state.photoOption}: {value}</h3>
                    <span className="text-xs text-muted-foreground">{chosen.length} of {MAX_PHOTOS_PER_VALUE} photos</span>
                  </div>
                  {chosen.length > 0 && (
                    <ol className="flex flex-wrap gap-2" aria-label={`Photos of ${value}, in order`}>
                      {chosen.map((imageId, n) => {
                        const image = product.images.find((img) => img.id === imageId)
                        if (!image) return null
                        const name = `photo ${(imageIndex.get(imageId) ?? 0) + 1}`
                        return (
                          <li key={imageId} className="flex flex-col items-center gap-1">
                            <img src={image.url} alt={`${value}, ${name}`} className="size-16 rounded-md border object-cover" />
                            <div className="flex">
                              <Button type="button" variant="ghost" size="icon-xs" aria-label={`Move ${name} of ${value} earlier`} disabled={n === 0} onClick={() => setPhotos(value, movePhoto(chosen, n, -1))}><ArrowLeftIcon /></Button>
                              <Button type="button" variant="ghost" size="icon-xs" aria-label={`Move ${name} of ${value} later`} disabled={n === chosen.length - 1} onClick={() => setPhotos(value, movePhoto(chosen, n, 1))}><ArrowRightIcon /></Button>
                              <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove ${name} from ${value}`} onClick={() => setPhotos(value, chosen.filter((id) => id !== imageId))}><XIcon /></Button>
                            </div>
                          </li>
                        )
                      })}
                    </ol>
                  )}
                  <div role="group" aria-label={`Pick photos for ${value}`} className="flex flex-wrap gap-1.5">
                    {product.images.map((image, n) => {
                      const on = chosen.includes(image.id)
                      const full = !on && chosen.length >= MAX_PHOTOS_PER_VALUE
                      return (
                        <button
                          key={image.id}
                          type="button"
                          aria-pressed={on}
                          aria-label={`Photo ${n + 1} for ${value}`}
                          disabled={full}
                          onClick={() => setPhotos(value, togglePhoto(chosen, image.id))}
                          className={cn(
                            'relative size-12 overflow-hidden rounded-md border-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-40',
                            on ? 'border-primary' : 'border-transparent',
                          )}
                        >
                          <img src={image.url} alt="" className="size-full object-cover" />
                          {on && (
                            <span aria-hidden className="absolute top-0.5 right-0.5 grid size-4 place-content-center rounded-full bg-primary text-primary-foreground">
                              <CheckIcon className="size-3" />
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                  {error && <p className="text-sm text-destructive">{error}</p>}
                </li>
              )
            })}
          </ul>
        )}

        {errors.form && <p role="alert" className="text-sm text-destructive">{errors.form}</p>}
        <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-4">
          {dirty && <span className="text-sm text-muted-foreground">Unsaved changes</span>}
          <Button type="button" disabled={!dirty || save.isPending} onClick={submit}>
            {save.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            Save photos by colour
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
