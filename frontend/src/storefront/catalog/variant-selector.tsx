import { useId } from 'react'
import { CheckIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLocale } from '../i18n/locale'
import type { ProductDetail, ProductOption, ProductOptionValue } from '../types'
import { chipImageOf, sizeOptionIndex } from './option-photos'
import { SizeGuideButton } from './size-guide'
import { valueStatus, type Selection } from './variant-selection'

/**
 * One control per option: colour chips, photo chips (P1a), buttons (pills) or a select for text
 * options. Chips and buttons are native radio inputs, so arrow keys and screen readers work as
 * usual. Values that cannot be combined with the earlier choices are disabled; sold-out values stay
 * selectable (to ask for a back-in-stock e-mail) and are crossed out, with "(sold out)" for screen
 * readers. A chosen chip has a ring and a check mark, so the choice never relies on colour alone.
 * The size guide (P1a) opens from next to the size option, else from under the options.
 */
export function VariantSelector({ product, selection, onChoose }: { product: ProductDetail; selection: Selection; onChoose: (optionName: string, value: string) => void }) {
  const guide = product.size_guide ?? null
  if (product.options.length === 0) return guide ? <SizeGuideButton guide={guide} /> : null
  const sizeIndex = guide ? sizeOptionIndex(product.options) : -1

  return (
    <div className="flex flex-col gap-5" data-testid="variant-selector">
      {product.options.map((option, index) => {
        const props = { product, option, index, selection, onChoose }
        const control = option.display === 'text' ? <OptionSelect key={option.name} {...props} /> : <OptionRadios key={option.name} {...props} />
        if (index !== sizeIndex || !guide) return control
        return (
          <div key={option.name} className="flex flex-col gap-1">
            {control}
            <SizeGuideButton guide={guide} />
          </div>
        )
      })}
      {guide && sizeIndex < 0 && <SizeGuideButton guide={guide} />}
    </div>
  )
}

type OptionProps = { product: ProductDetail; option: ProductOption; index: number; selection: Selection; onChoose: (optionName: string, value: string) => void }

type ChipLook = { kind: 'color'; hex: string } | { kind: 'image'; url: string } | { kind: 'button' }

/** How a value is drawn: photo chips need a photo, colour chips a colour; anything else is a pill. */
function chipLook(product: ProductDetail, option: ProductOption, value: ProductOptionValue): ChipLook {
  if (option.display === 'image') {
    const image = chipImageOf(product, value)
    if (image) return { kind: 'image', url: image.url }
  }
  if ((option.display === 'swatch' || option.display === 'image') && value.swatch_hex) return { kind: 'color', hex: value.swatch_hex }
  return { kind: 'button' }
}

function OptionRadios({ product, option, index, selection, onChoose }: OptionProps) {
  const name = useId()
  const { t } = useLocale()
  const current = selection[option.name]

  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold text-sf-heading">
        {option.name}: <span className="font-normal text-sf-text">{current ?? t('catalog.variant.choose')}</span>
      </legend>
      <div className="flex flex-wrap gap-2">
        {option.values.map((v, i) => {
          const status = valueStatus(product, selection, index, v.value)
          const soldOut = status === 'sold_out'
          const checked = current === v.value
          const look = chipLook(product, option, v)
          const chip = look.kind !== 'button'
          const id = `${name}-${i}`
          // Chips are named "Colour: Red"; pills by their value ("M"), read inside the "Size" group.
          const label = chip ? t('catalog.variant.chipName', { option: option.name, value: v.value }) : v.value
          return (
            <div key={v.value}>
              <input
                type="radio"
                id={id}
                name={name}
                value={v.value}
                checked={checked}
                disabled={status === 'unavailable'}
                onChange={() => onChoose(option.name, v.value)}
                className="peer sr-only"
              />
              <label
                htmlFor={id}
                title={soldOut ? t('catalog.variant.soldOut', { value: v.value }) : v.value}
                data-sold-out={soldOut || undefined}
                className={cn(
                  'relative flex cursor-pointer items-center justify-center border-2 transition peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-sf-accent peer-disabled:cursor-not-allowed peer-disabled:opacity-35',
                  chip
                    ? cn('rounded-full p-0.5', look.kind === 'image' ? 'size-12' : 'size-10', checked ? 'border-sf-accent ring-2 ring-sf-accent/30' : 'border-sf-border hover:border-sf-heading/50')
                    : 'h-10 min-w-12 rounded-sf-button border-sf-border bg-sf-surface px-4 text-sm font-semibold text-sf-heading peer-checked:border-sf-accent peer-checked:bg-sf-accent peer-checked:text-sf-accent-foreground',
                  soldOut && !chip && 'border-dashed text-sf-text peer-checked:border-solid',
                )}
              >
                {look.kind === 'color' && <span className="block size-full rounded-full border border-black/10" style={{ backgroundColor: look.hex }} aria-hidden />}
                {look.kind === 'image' && <img src={look.url} alt="" aria-hidden loading="lazy" decoding="async" width={48} height={48} className="block size-full rounded-full border border-black/10 object-cover" />}
                {!chip && <span aria-hidden className={cn(soldOut && 'line-through decoration-2')}>{v.value}</span>}
                {chip && soldOut && <span aria-hidden className={cn('absolute h-0.5 rotate-45 bg-sf-heading/80', look.kind === 'image' ? 'w-13' : 'w-11')} />}
                {chip && checked && (
                  <span aria-hidden className="absolute -top-1 -right-1 grid size-5 place-items-center rounded-full border-2 border-sf-surface bg-sf-accent text-sf-accent-foreground" data-testid="chip-check">
                    <CheckIcon className="size-3" strokeWidth={3} />
                  </span>
                )}
                {/* One text node, so the accessible name reads "L (sold out)" / "Colour: Red (sold out)". */}
                <span className="sr-only">{soldOut ? t('catalog.variant.soldOut', { value: label }) : label}</span>
              </label>
            </div>
          )
        })}
      </div>
    </fieldset>
  )
}

function OptionSelect({ product, option, index, selection, onChoose }: OptionProps) {
  const id = useId()
  const { t } = useLocale()

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-semibold text-sf-heading">{option.name}</label>
      <select
        id={id}
        value={selection[option.name] ?? ''}
        onChange={(e) => onChoose(option.name, e.target.value)}
        className="h-11 max-w-xs rounded-lg border border-sf-border bg-sf-surface px-3 text-sf-heading focus-visible:outline-2 focus-visible:outline-sf-accent"
      >
        {selection[option.name] === undefined && <option value="" disabled>{t('catalog.variant.chooseOption', { option: option.name.toLowerCase() })}</option>}
        {option.values.map((v) => {
          const status = valueStatus(product, selection, index, v.value)
          return (
            <option key={v.value} value={v.value} disabled={status === 'unavailable'}>
              {status === 'sold_out' ? t('catalog.variant.soldOut', { value: v.value }) : status === 'unavailable' ? t('catalog.variant.unavailable', { value: v.value }) : v.value}
            </option>
          )
        })}
      </select>
    </div>
  )
}
