import { useId, useState } from 'react'
import { ImageIcon, ImagePlusIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useMediaLookup } from '@/features/media/api'
import { MediaPicker } from '@/features/media/components/media-picker'
import { MAX_PHOTOS, postingOrder, type PickedPhoto } from '@/features/marketing/social'
import { useProductQuery } from '@/features/products/api'
import { cn } from '@/lib/utils'

type Props = {
  productId: string | null
  /** Product photos need products.view. */
  canSeeProducts: boolean
  /** The media library needs media.manage. */
  canUseLibrary: boolean
  photos: PickedPhoto[]
  onChange: (photos: PickedPhoto[]) => void
  error?: string
}

/**
 * Photo picker of the composer: the product's photos as toggles plus images from the media library.
 * Numbers show the posting order (product photos first, then library images); the first is the cover.
 */
export function PostPhotos({ productId, canSeeProducts, canUseLibrary, photos, onChange, error }: Props) {
  const id = useId()
  const [libraryOpen, setLibraryOpen] = useState(false)
  const product = useProductQuery(canSeeProducts && productId ? productId : undefined)
  const libraryIds = photos.filter((p) => p.kind === 'media').map((p) => p.id)
  const lookup = useMediaLookup(photos.filter((p) => p.kind === 'media' && !p.url).map((p) => p.id))

  const productPhotos: PickedPhoto[] = (product.data?.images ?? []).map((i) => ({ id: i.id, url: i.url, kind: 'product_image', name: i.original_name }))
  // Chosen product photos the product no longer lists (or while it loads) stay visible.
  for (const p of photos) if (p.kind === 'product_image' && !productPhotos.some((x) => x.id === p.id)) productPhotos.push(p)
  const tiles = [...productPhotos, ...photos.filter((p) => p.kind === 'media')]

  const ordered = postingOrder(photos)
  const position = (photo: PickedPhoto) => ordered.findIndex((p) => p.id === photo.id && p.kind === photo.kind) + 1
  const full = photos.length >= MAX_PHOTOS
  const productCount = photos.filter((p) => p.kind === 'product_image').length

  const toggle = (photo: PickedPhoto) => {
    if (position(photo) > 0) onChange(photos.filter((p) => !(p.id === photo.id && p.kind === photo.kind)))
    else if (!full) onChange([...photos, photo])
  }

  const urlOf = (photo: PickedPhoto) => photo.url || lookup.byId.get(photo.id)?.url || ''

  return (
    <div role="group" aria-labelledby={`${id}-label`} aria-describedby={`${id}-help`} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span id={`${id}-label`} className="text-sm leading-none font-medium">Photos</span>
        <span className="text-xs text-muted-foreground" data-testid="photo-count">{photos.length} of {MAX_PHOTOS} chosen</span>
      </div>
      <p id={`${id}-help`} className={error ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
        {error ?? 'Tap photos to add them. The numbers show the order — the first photo is the cover. Instagram needs at least one.'}
      </p>

      {tiles.length > 0 ? (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5" aria-label="Photos to choose from">
          {tiles.map((photo, i) => {
            const pos = position(photo)
            const name = photo.name ?? (photo.kind === 'media' ? 'Library image' : `Product photo ${i + 1}`)
            return (
              <li key={`${photo.kind}-${photo.id}`}>
                <button
                  type="button"
                  aria-pressed={pos > 0}
                  aria-label={pos > 0 ? `${name}, photo ${pos} of the post` : name}
                  disabled={pos === 0 && full}
                  onClick={() => toggle(photo)}
                  className={cn(
                    'relative block aspect-square w-full overflow-hidden rounded-md border bg-muted outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-40',
                    pos > 0 && 'ring-2 ring-primary ring-offset-2',
                  )}
                >
                  {urlOf(photo) ? (
                    <img src={urlOf(photo)} alt="" loading="lazy" className="size-full object-cover" />
                  ) : (
                    <ImageIcon className="m-auto size-5 text-muted-foreground" aria-hidden />
                  )}
                  {pos > 0 && (
                    <span aria-hidden className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                      {pos}
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
          {productId
            ? product.isPending && canSeeProducts
              ? 'Loading the product’s photos…'
              : 'This product has no photos yet. Add photos to the product, or pick images from the media library.'
            : 'Choose a product to pick from its photos.'}
        </p>
      )}

      {canUseLibrary && (
        <>
          <Button type="button" variant="outline" size="sm" className="self-start" disabled={productCount >= MAX_PHOTOS} onClick={() => setLibraryOpen(true)}>
            <ImagePlusIcon data-icon="inline-start" /> Add from media library
          </Button>
          <MediaPicker
            open={libraryOpen}
            onOpenChange={setLibraryOpen}
            title="Add photos from the media library"
            multiple
            max={MAX_PHOTOS - productCount}
            selected={libraryIds}
            onConfirm={(ids) => {
              const known = new Map(photos.filter((p) => p.kind === 'media').map((p) => [p.id, p.url]))
              onChange([...photos.filter((p) => p.kind === 'product_image'), ...ids.map((mediaId) => ({ id: mediaId, url: known.get(mediaId) ?? '', kind: 'media' as const }))])
            }}
          />
        </>
      )}
    </div>
  )
}
