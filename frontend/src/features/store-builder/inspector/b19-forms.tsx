/*
 * Content tab forms of the B19 elements: the scroll story (a sticky picture beside 2–6 steps) and
 * the horizontal gallery (pictures or products moving sideways). Steps and pictures are item
 * lists (add / remove / duplicate / drag or keyboard to reorder) with their own Bangla fields
 * (`steps.<id>.heading`, `items.<id>.alt`); products use the product grid's ordered picker. A
 * click on a step or picture on the canvas opens its card here (./item-reveal).
 */

import { useState } from 'react'
import { TriangleAlertIcon } from 'lucide-react'
import { useMediaLookup } from '@/features/media/api'
import { ProductPicker, type PickedItem } from '@/features/online-catalog/components/ordered-picker'
import { useProductNames } from '@/features/products/api'
import type { Element, HorizontalGalleryElement, HorizontalGalleryItem, HorizontalGalleryProps, ScrollStoryElement, ScrollStoryStep } from '@/storefront/builder/types'
import { B19_LIMITS, B19_TEXT_LIMITS } from '@/storefront/builder/validate'
import {
  CARD_WIDTHS,
  GALLERY_SOURCES,
  MEDIA_RATIOS,
  MEDIA_SIDES,
  STORY_TRANSITIONS,
  galleryCount,
  newGalleryItem,
  newStep,
  pictureWarning,
  pinIsLong,
  pinWarnLimit,
  stepSummary,
  withItemLink,
  withSource,
  withStepLink,
  withStepLinkLabel,
  withoutTranslation,
} from './b19-model'
import { ImageChooser, LinkField } from './fields'
import { ImageListBangla, ImageListField, ImageThumb, ItemBangla, Note } from './form-kit'
import { itemErrors, limitIn, patch, setList, type ElementFormProps } from './form-model'
import { useItemReveal } from './item-reveal'
import { ItemList } from './item-list'
import { ChoiceField, TextField, ToggleField } from './pickers'

export type B19FormProps<N> = ElementFormProps<N> & {
  /** GET /elements `limits` (`horizontal_gallery_pin_warn`). */
  limits?: Record<string, unknown>
}

const limit = (type: string, field: string) => limitIn(B19_TEXT_LIMITS as Record<string, Record<string, number>>, type, field)

/** A gentle "still needed" line in a card (amber, not an error: the page still saves). */
function Warning({ children, testId }: { children: string; testId: string }) {
  return (
    <p className="flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-400" data-testid={testId}>
      <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  )
}

/* ----------------------------------------------------------------------------------------------
 * Scroll story
 * -------------------------------------------------------------------------------------------- */

export function ScrollStoryForm(props: B19FormProps<ScrollStoryElement>) {
  const { node, onChange, errors } = props
  const p = node.props
  const steps = p.steps
  const reveal = useItemReveal(node.id)
  const { byId } = useMediaLookup(steps.map((s) => s.media_id).filter((id): id is string => !!id))
  const replace = (step: ScrollStoryStep, typing?: string, media?: Parameters<typeof setList>[5]) =>
    setList(node, onChange, 'steps', steps.map((x) => (x.id === step.id ? step : x)), typing ? { typing: `${step.id}.${typing}` } : undefined, media)

  return (
    <div className="flex flex-col gap-4">
      <ItemList<ScrollStoryStep>
        label="Steps"
        noun="step"
        items={steps}
        min={B19_LIMITS.scrollStorySteps.min}
        max={B19_LIMITS.scrollStorySteps.max}
        errors={errors}
        errorPrefix="steps"
        reveal={reveal}
        create={(id) => newStep(id, steps.length + 1)}
        summary={stepSummary}
        lead={(step) => <ImageThumb id={step.media_id} byId={byId} />}
        onChange={(next, change) => setList(node, onChange, 'steps', next, change)}
      >
        {(step, i, update) => {
          const e = itemErrors(errors, 'steps', i)
          const warning = pictureWarning(step)
          return (
            <>
              <fieldset className="flex flex-col gap-1.5" data-check-field={`steps.${step.id}.media_id`}>
                <legend className="mb-1.5 text-sm font-medium">Picture</legend>
                <ImageChooser
                  title="Choose the step’s picture"
                  value={step.media_id}
                  error={e.media_id}
                  onChange={(media_id, ref) => replace({ ...step, media_id, alt: step.alt || ref?.alt || '' }, undefined, ref ? { [ref.id]: ref } : undefined)}
                />
              </fieldset>
              <TextField
                label="Description (alt text)"
                hint="Required: describes the picture for screen readers."
                value={step.alt}
                max={limit('scroll_story', 'steps.*.alt')}
                error={e.alt}
                onChange={(alt) => update({ alt }, 'alt')}
              />
              {warning && <Warning testId="step-picture-warning">{warning}</Warning>}
              <TextField label="Small line above the heading" hint="Optional, e.g. “Since 2012”." value={step.kicker} max={limit('scroll_story', 'steps.*.kicker')} error={e.kicker} onChange={(kicker) => update({ kicker }, 'kicker')} />
              <TextField label="Heading" value={step.heading} max={limit('scroll_story', 'steps.*.heading')} error={e.heading} onChange={(heading) => update({ heading }, 'heading')} />
              <TextField label="Text" multiline hint="Plain text." value={step.text} max={limit('scroll_story', 'steps.*.text')} error={e.text} onChange={(text) => update({ text }, 'text')} />
              <LinkField
                label="Link"
                value={step.link?.url ?? null}
                error={e['link.url'] ?? e.link}
                hint="Optional: a link under the text."
                onChange={(url) => {
                  const next = withStepLink(step, url)
                  if (next.link) return replace(next, 'link')
                  onChange({ ...node, props: { ...p, steps: steps.map((x) => (x.id === step.id ? next : x)) }, translations: withoutTranslation(node.translations, `steps.${step.id}.link.label`) })
                }}
              />
              {step.link && (
                <TextField label="Link text" value={step.link.label} max={limit('scroll_story', 'steps.*.link.label')} error={e['link.label']} onChange={(label) => replace(withStepLinkLabel(step, label), 'link.label')} />
              )}
              <ItemBangla
                {...props}
                list="steps"
                itemId={step.id}
                fields={[
                  { name: 'alt', label: 'Description (alt text)', base: step.alt },
                  { name: 'kicker', label: 'Small line above the heading', base: step.kicker },
                  { name: 'heading', label: 'Heading', base: step.heading },
                  { name: 'text', label: 'Text', base: step.text, kind: 'textarea' },
                  ...(step.link ? [{ name: 'link.label', label: 'Link text', base: step.link.label }] : []),
                ]}
              />
            </>
          )
        }}
      </ItemList>
      <ChoiceField label="Picture side" value={p.media_side} error={errors.media_side} options={MEDIA_SIDES} onChange={(media_side) => patch(node, onChange, { media_side })} />
      <ChoiceField label="Picture shape" value={p.media_ratio} error={errors.media_ratio} options={MEDIA_RATIOS} onChange={(media_ratio) => patch(node, onChange, { media_ratio })} />
      <ChoiceField label="Picture change" value={p.transition} error={errors.transition} options={STORY_TRANSITIONS} onChange={(transition) => patch(node, onChange, { transition })} />
      <ToggleField
        label="Show progress dots"
        hint="Dots beside the story show where shoppers are; clicking one jumps to its step."
        checked={p.progress_dots}
        onChange={(progress_dots) => patch(node, onChange, { progress_dots })}
      />
      <Note>
        On computers the picture stays in view and changes as shoppers scroll through the steps. On phones, and for shoppers who turned off animations, each step shows its own
        picture above its text. In the editor it shows like that too unless Preview motion is on.
      </Note>
    </div>
  )
}

/* ----------------------------------------------------------------------------------------------
 * Horizontal gallery
 * -------------------------------------------------------------------------------------------- */

function GalleryProducts({ ids, onChange, error }: { ids: string[]; onChange: (ids: string[]) => void; error?: string }) {
  // Names of products picked in this session, so the list doesn't flash "Loading" after each edit.
  const [picked, setPicked] = useState<Map<string, PickedItem>>(() => new Map())
  const names = useProductNames(ids)
  const { min, max } = B19_LIMITS.horizontalGalleryProducts
  const value: PickedItem[] = ids.map((id) => {
    const found = names.get(id)
    return { id, name: found?.name ?? picked.get(id)?.name ?? 'Loading…', image_url: found?.image_url ?? picked.get(id)?.image_url ?? null }
  })
  return (
    <div data-check-field="product_ids">
      <ProductPicker
        label="Products"
        addLabel="Add product"
        value={value}
        max={max}
        error={error}
        hint={`Shown in this order, ${min} to ${max}. Products that aren’t sold online are skipped.`}
        onChange={(next) => {
          setPicked((current) => {
            const map = new Map(current)
            for (const item of next) if (item.name && item.name !== 'Loading…') map.set(item.id, item)
            return map
          })
          onChange(next.map((item) => item.id))
        }}
      />
    </div>
  )
}

export function HorizontalGalleryForm(props: B19FormProps<HorizontalGalleryElement>) {
  const { node, onChange, errors, limits } = props
  const p = node.props
  const reveal = useItemReveal(node.id)
  // What the other source had, so switching back and forth in one session loses nothing.
  const [stash, setStash] = useState<{ items?: HorizontalGalleryItem[]; product_ids?: string[] }>({})
  const pinLimit = pinWarnLimit(limits)
  const items = p.items ?? []
  const productIds = p.product_ids ?? []
  const switchSource = (source: HorizontalGalleryProps['source']) => {
    if (source === p.source) return
    setStash((current) => (p.source === 'products' ? { ...current, product_ids: productIds } : { ...current, items }))
    onChange({ ...node, props: withSource({ ...p, items, product_ids: productIds }, source, stash) })
  }
  const productError = errors.product_ids ?? Object.entries(errors).find(([key]) => key.startsWith('product_ids.'))?.[1]

  return (
    <div className="flex flex-col gap-4">
      <ChoiceField
        label="Show"
        value={p.source}
        error={errors.source}
        options={GALLERY_SOURCES}
        hint={p.source === 'products' ? 'Product cards with price and Add to cart, from your online store.' : 'Your own pictures from the media library.'}
        onChange={switchSource}
      />
      {p.source === 'products' ? (
        <GalleryProducts ids={productIds} error={productError} onChange={(product_ids) => patch(node, onChange, { product_ids })} />
      ) : (
        <ImageListField<HorizontalGalleryItem>
          label="Pictures"
          noun="picture"
          list="items"
          items={items}
          range={B19_LIMITS.horizontalGalleryItems}
          errors={errors}
          reveal={reveal}
          make={(id, media, mediaId) => newGalleryItem(id, mediaId, media?.alt ?? '')}
          onChange={(next, change, media) => setList(node, onChange, 'items', next, change, media)}
        >
          {(item, i, update) => {
            const e = itemErrors(errors, 'items', i)
            const warning = pictureWarning(item)
            return (
              <>
                <TextField label="Description (alt text)" hint="Required: describes the picture for screen readers." value={item.alt} max={limit('horizontal_gallery', 'items.*.alt')} error={e.alt} onChange={(alt) => update({ alt }, 'alt')} />
                {warning && <Warning testId="gallery-picture-warning">{warning}</Warning>}
                <TextField label="Caption" hint="Optional; shown under the picture." value={item.caption} max={limit('horizontal_gallery', 'items.*.caption')} error={e.caption} onChange={(caption) => update({ caption }, 'caption')} />
                <LinkField
                  label="Link"
                  value={item.link?.url ?? null}
                  error={e.link ?? e['link.url']}
                  hint="Optional: the picture becomes a link."
                  onChange={(url) => setList(node, onChange, 'items', items.map((x) => (x.id === item.id ? withItemLink(x, url) : x)), { typing: `${item.id}.link` })}
                />
                <ImageListBangla {...props} list="items" item={item} />
              </>
            )
          }}
        </ImageListField>
      )}
      <ChoiceField label="Card width" value={p.card_width} error={errors.card_width} options={CARD_WIDTHS} onChange={(card_width) => patch(node, onChange, { card_width })} />
      <ToggleField
        label="Pin while scrolling"
        hint="On computers the section stays in place while the cards move sideways as shoppers scroll down. Phones always swipe."
        checked={p.pin}
        onChange={(pin) => patch(node, onChange, { pin })}
      />
      {pinIsLong({ ...p, items, product_ids: productIds }, pinLimit) && (
        <Warning testId="gallery-pin-hint">{`${galleryCount({ ...p, items, product_ids: productIds })} cards is a long pinned scroll, which tires shoppers. Turn pinning off or keep ${pinLimit} or fewer.`}</Warning>
      )}
      <ToggleField label="Show a progress bar" hint="A thin bar under the cards shows how far shoppers have come." checked={p.show_progress} onChange={(show_progress) => patch(node, onChange, { show_progress })} />
      <Note>Shoppers on phones, with animations turned off, or when pinning is off swipe the cards and get previous / next buttons.</Note>
    </div>
  )
}

/** The B19 form for a node, or null for other types. */
export function B19Form(props: B19FormProps<Element>) {
  const pass = <N,>() => props as unknown as B19FormProps<N>
  switch (props.node.type) {
    case 'scroll_story':
      return <ScrollStoryForm {...pass<ScrollStoryElement>()} />
    case 'horizontal_gallery':
      return <HorizontalGalleryForm {...pass<HorizontalGalleryElement>()} />
    default:
      return null
  }
}
