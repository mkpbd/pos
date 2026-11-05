import { useId } from 'react'
import { cn } from '@/lib/utils'
import { useLocale } from '../i18n/locale'
import type { ProductDetail, ProductOption } from '../types'
import { valueStatus, type Selection } from './variant-selection'

/**
 * One control per option: swatches (colour dots), buttons (pills) or a select for text
 * options. Swatches and buttons are native radio inputs, so arrow keys and screen readers
 * work as usual. Values that cannot be combined with the earlier choices are disabled;
 * sold-out values stay selectable and are drawn dashed (swatches crossed out).
 */
export function VariantSelector({ product, selection, onChoose }: { product: ProductDetail; selection: Selection; onChoose: (optionName: string, value: string) => void }) {
  if (product.options.length === 0) return null

  return (
    <div className="flex flex-col gap-5" data-testid="variant-selector">
      {product.options.map((option, index) =>
        option.display === 'text' ? (
          <OptionSelect key={option.name} product={product} option={option} index={index} selection={selection} onChoose={onChoose} />
        ) : (
          <OptionRadios key={option.name} product={product} option={option} index={index} selection={selection} onChoose={onChoose} />
        ),
      )}
    </div>
  )
}

type OptionProps = { product: ProductDetail; option: ProductOption; index: number; selection: Selection; onChoose: (optionName: string, value: string) => void }

function OptionRadios({ product, option, index, selection, onChoose }: OptionProps) {
  const name = useId()
  const { t } = useLocale()
  const current = selection[option.name]
  const swatch = option.display === 'swatch'

  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold text-sf-heading">
        {option.name}: <span className="font-normal text-sf-text">{current ?? t('catalog.variant.choose')}</span>
      </legend>
      <div className="flex flex-wrap gap-2">
        {option.values.map((v, i) => {
          const status = valueStatus(product, selection, index, v.value)
          const id = `${name}-${i}`
          return (
            <div key={v.value}>
              <input
                type="radio"
                id={id}
                name={name}
                value={v.value}
                checked={current === v.value}
                disabled={status === 'unavailable'}
                onChange={() => onChoose(option.name, v.value)}
                className="peer sr-only"
              />
              <label
                htmlFor={id}
                title={status === 'sold_out' ? t('catalog.variant.soldOut', { value: v.value }) : v.value}
                className={cn(
                  'relative flex cursor-pointer items-center justify-center border-2 transition peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-sf-accent peer-disabled:cursor-not-allowed peer-disabled:opacity-35',
                  swatch
                    ? 'size-10 rounded-full border-sf-border p-0.5 peer-checked:border-sf-accent'
                    : 'h-10 min-w-12 rounded-sf-button border-sf-border bg-sf-surface px-4 text-sm font-semibold text-sf-heading peer-checked:border-sf-accent peer-checked:bg-sf-accent peer-checked:text-sf-accent-foreground',
                  status === 'sold_out' && !swatch && 'border-dashed text-sf-text peer-checked:border-solid',
                )}
              >
                {swatch ? (
                  <>
                    <span className="block size-full rounded-full border border-black/10" style={{ backgroundColor: v.swatch_hex ?? undefined }} aria-hidden />
                    {status === 'sold_out' && <span aria-hidden className="absolute h-0.5 w-11 rotate-45 bg-sf-heading/70" />}
                  </>
                ) : (
                  <span aria-hidden>{v.value}</span>
                )}
                {/* One text node, so the accessible name reads "L (out of stock)". */}
                <span className="sr-only">{status === 'sold_out' ? t('catalog.variant.soldOut', { value: v.value }) : v.value}</span>
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
