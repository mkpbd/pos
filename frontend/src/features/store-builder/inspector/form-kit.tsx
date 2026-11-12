/*
 * Shared pieces of the B6 / B8a element forms: the Bangla fields of a node and of a list item,
 * notes, a rich text field, a number field, and the image list (several images picked from the
 * media library at once, each with its own card).
 */

import { useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ImagePlusIcon } from 'lucide-react'
import { FormField } from '@/components/common/form-field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { RichTextEditor } from '@/features/content/components/rich-text-editor'
import { mediaKeys, useMediaLookup, type MediaItem } from '@/features/media/api'
import { MediaPicker } from '@/features/media/components/media-picker'
import type { TranslationFieldKind } from '@/features/translations/translations'
import { api, toPaginated } from '@/lib/api/client'
import type { MediaRef } from '@/storefront/types'
import { newItemId, type ItemListChange } from './b6-model'
import { FieldError, ImageChooser, NodeBangla, type Errors } from './fields'
import { counter } from './format-text'
import { itemErrors, type AnyElement, type ElementFormProps } from './form-model'
import { ItemList } from './item-list'
import { translationLimit } from './validate'

export type BanglaField = { name: string; label: string; base: string; kind?: TranslationFieldKind }

/** The Bangla fields of a node's own props (not in the setup dialog). */
export function Bangla<N extends AnyElement>({ node, onChange, errors, bangla, setup, fields }: ElementFormProps<N> & { fields: BanglaField[] }) {
  if (!bangla || setup) return null
  return (
    <NodeBangla
      fields={fields.map((f) => ({ ...f, max: translationLimit(node.type, f.name) }))}
      translations={node.translations}
      errors={errors}
      onChange={(translations) => onChange({ ...node, translations }, { coalesceKey: `${node.id}:bn` })}
    />
  )
}

/** The Bangla fields of one list item (`<list>.<item_id>.<field>`; `list` may itself be a path such as `plans.p_1.features`). */
export function ItemBangla<N extends AnyElement>(props: ElementFormProps<N> & { list: string; itemId: string; fields: BanglaField[] }) {
  const { list, itemId, fields } = props
  return <Bangla {...props} fields={fields.map((f) => ({ ...f, name: `${list}.${itemId}.${f.name}` }))} />
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>
}

/** A rich text field for a list item (accordion panel, tab). */
export function RichField({ id, label, value, max, error, onChange }: { id: string; label: string; value: string; max: number; error?: string; onChange: (html: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <RichTextEditor key={id} id={id} label={label} value={value} invalid={!!error} onChange={onChange} />
      {error ? <FieldError message={error} /> : <p className="text-xs text-muted-foreground">{counter(value, max)} characters of HTML</p>}
    </div>
  )
}

/** A number with a range; `step` below 1 allows decimals (rounded to `decimals`, default 2). */
export function NumberField({ label, value, min, max, step = 1, decimals = 2, onChange, error, hint }: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  decimals?: number
  onChange: (n: number) => void
  error?: string
  hint?: string
}) {
  const [text, setText] = useState(String(value))
  const [seen, setSeen] = useState(value)
  if (seen !== value) {
    setSeen(value)
    setText(String(value))
  }
  const factor = 10 ** decimals
  return (
    <FormField label={label} error={error} hint={hint}>
      <Input
        type="number"
        inputMode={step < 1 ? 'decimal' : 'numeric'}
        min={min}
        max={max}
        step={step}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          const n = Number(e.target.value)
          if (e.target.value !== '' && Number.isFinite(n)) onChange(step < 1 ? Math.round(n * factor) / factor : Math.round(n))
        }}
      />
    </FormField>
  )
}

const toRef = (m: MediaItem): MediaRef => ({ id: m.id, url: m.url, srcset: m.srcset, width: m.width, height: m.height, alt: m.alt })

/** Looks up chosen media (the picker's cached pages first, then the API) so the canvas can draw them at once. */
function useMediaRefs() {
  const queryClient = useQueryClient()
  return async (ids: string[]): Promise<{ refs: Record<string, MediaRef>; items: Record<string, MediaItem> }> => {
    const items: Record<string, MediaItem> = {}
    for (const [, data] of queryClient.getQueriesData<{ items?: MediaItem[] }>({ queryKey: mediaKeys.all })) {
      for (const m of data?.items ?? []) if (ids.includes(m.id)) items[m.id] = m
    }
    const missing = ids.filter((id) => !items[id])
    if (missing.length > 0) {
      try {
        for (const m of (await api.get<MediaItem[]>('/media', { query: { ids: missing.join(','), per_page: 100 } }).then(toPaginated)).items) items[m.id] = m
      } catch {
        // The canvas resolves them later.
      }
    }
    return { refs: Object.fromEntries(Object.values(items).map((m) => [m.id, toRef(m)])), items }
  }
}

type ImageItem = { id: string; media_id: string | null; alt: string }

export function ImageThumb({ id, byId }: { id: string | null; byId: Map<string, MediaItem> }) {
  const item = id ? byId.get(id) : undefined
  return (
    <span className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted">
      {item ? <img src={item.url} alt="" className="size-full object-cover" /> : null}
    </span>
  )
}

/**
 * The image list of a gallery, carousel, logo strip or photo grid: "Add images" opens the media
 * library for several at once (their alt texts start from the library's); each card has its own
 * fields.
 */
export function ImageListField<T extends ImageItem>(props: {
  label: string
  noun: string
  list: string
  items: T[]
  range: { min: number; max: number }
  errors: Errors
  make: (id: string, media: MediaItem | undefined, mediaId: string) => T
  onChange: (items: T[], change?: ItemListChange, media?: Record<string, MediaRef>) => void
  children: (item: T, index: number, update: (patch: Partial<T>, coalesce?: string) => void) => ReactNode
}) {
  const { label, noun, list, items, range, errors, make, onChange, children } = props
  const [open, setOpen] = useState(false)
  const lookup = useMediaRefs()
  const { byId } = useMediaLookup(items.map((i) => i.media_id).filter((id): id is string => !!id))
  const room = range.max - items.length
  const add = async (ids: string[]) => {
    const fresh = ids.slice(0, room)
    if (fresh.length === 0) return
    const { refs, items: found } = await lookup(fresh)
    const next = [...items]
    for (const mediaId of fresh) next.push(make(newItemId(next), found[mediaId], mediaId))
    onChange(next, undefined, refs)
  }
  return (
    <div className="flex flex-col gap-2">
      <ItemList<T>
        label={label}
        noun={noun}
        items={items}
        min={range.min}
        max={range.max}
        errors={errors}
        errorPrefix={list}
        openNew={false}
        create={(id) => make(id, undefined, '')}
        summary={(item, i) => item.alt || `${noun[0]!.toUpperCase()}${noun.slice(1)} ${i + 1}`}
        lead={(item) => <ImageThumb id={item.media_id} byId={byId} />}
        onChange={(next, change) => onChange(next, change)}
      >
        {(item, i, update) => (
          <>
            <ImageChooser
              title={`Choose the ${noun}`}
              value={item.media_id || null}
              error={itemErrors(errors, list, i).media_id}
              onChange={(media_id, ref) => {
                if (!media_id) return
                onChange(items.map((x) => (x.id === item.id ? { ...x, media_id } : x)), undefined, ref ? { [ref.id]: ref } : undefined)
              }}
            />
            {children(item, i, update)}
          </>
        )}
      </ItemList>
      <Button type="button" size="sm" className="self-start" disabled={room <= 0} onClick={() => setOpen(true)}>
        <ImagePlusIcon data-icon="inline-start" /> {items.length === 0 ? `Choose ${noun}s` : `Add ${noun}s`}
      </Button>
      <MediaPicker open={open} onOpenChange={setOpen} title={`Add ${noun}s`} multiple max={Math.max(room, 1)} selected={[]} onConfirm={(ids) => void add(ids)} />
    </div>
  )
}

/** The Bangla alt text (and caption) of an image list item. */
export function ImageListBangla<N extends AnyElement>(props: ElementFormProps<N> & { list: string; item: { id: string; alt: string; caption?: string }; captions?: boolean }) {
  const { item, captions = true } = props
  return (
    <ItemBangla
      {...props}
      itemId={item.id}
      fields={[{ name: 'alt', label: 'Description (alt text)', base: item.alt }, ...(captions ? [{ name: 'caption', label: 'Caption', base: item.caption ?? '' }] : [])]}
    />
  )
}

const INHERIT = 'inherit'

/** Items per row on desktop / tablet / mobile (tablet and mobile may follow the wider device). */
export function DeviceColumnsField({ label, noun, value, base, onChange, error }: {
  label: string
  /** "Photos" → "Photos per row on tablet". */
  noun: string
  value: { base: number; tablet?: number; mobile?: number }
  base: { min: number; max: number }
  onChange: (value: { base: number; tablet?: number; mobile?: number }) => void
  error?: string
}) {
  const set = (device: 'base' | 'tablet' | 'mobile', choice: string) => {
    const next = { ...value }
    if (choice === INHERIT) delete next[device as 'tablet' | 'mobile']
    else next[device] = Number(choice)
    onChange(next)
  }
  const range = (min: number) => Array.from({ length: base.max - min + 1 }, (_, i) => min + i)
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-sm font-medium">{label}</legend>
      <div className="grid grid-cols-3 gap-2">
        {(['base', 'tablet', 'mobile'] as const).map((device) => {
          const name = device === 'base' ? 'Desktop' : device === 'tablet' ? 'Tablet' : 'Mobile'
          const current = value[device]
          return (
            <div key={device} className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{name}</span>
              <Select value={current === undefined ? INHERIT : String(current)} onValueChange={(v) => set(device, v)}>
                <SelectTrigger className="w-full" aria-label={`${noun} per row on ${name.toLowerCase()}`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {device !== 'base' && <SelectItem value={INHERIT}>{device === 'tablet' ? 'As desktop' : 'As tablet'}</SelectItem>}
                  {(device === 'base' ? range(base.min) : range(1)).map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )
        })}
      </div>
      <FieldError message={error} />
    </fieldset>
  )
}
