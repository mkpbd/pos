import { BanknoteIcon, TruckIcon } from 'lucide-react'
import { useStorefront } from '../api'
import { useLocale } from '../i18n/locale'
import type { DeliveryOption, ProductDelivery } from '../types'
import { deliveryDays, deliveryFee, deliveryFreeOver, deliveryOptionsOf } from './delivery'

/** Zones listed before "More delivery areas" folds the rest away. */
const VISIBLE_ZONES = 3

/**
 * P1b: the delivery estimate near the price, from the shipping settings — per zone "Inside Dhaka:
 * 1–2 days · ৳60" — and "Cash on delivery available". Store-level, so the same on every product;
 * nothing when shipping is not set up. The checkout works out the real fee for the address.
 */
export function DeliveryNote({ delivery }: { delivery: ProductDelivery | null | undefined }) {
  const { t } = useLocale()
  const options = deliveryOptionsOf(delivery)
  const cod = delivery?.cod_available === true
  if (options.length === 0 && !cod) return null
  const shown = options.slice(0, VISIBLE_ZONES)
  const more = options.slice(VISIBLE_ZONES)

  return (
    <div className="flex flex-col gap-2.5 rounded-sf-card border border-sf-border px-4 py-3 text-sm" data-testid="delivery-note">
      {options.length > 0 && (
        <div className="flex items-start gap-2.5">
          <TruckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-sf-heading" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-sf-heading">{t('catalog.delivery.title')}</p>
            <ZoneList options={shown} />
            {more.length > 0 && (
              <details className="mt-1">
                <summary className="cursor-pointer py-1 font-semibold text-sf-link underline-offset-4 hover:underline">{t('catalog.delivery.moreAreas', { count: more.length })}</summary>
                <ZoneList options={more} />
              </details>
            )}
          </div>
        </div>
      )}
      {cod && (
        <p className="flex items-center gap-2.5 font-semibold text-sf-heading" data-testid="cod-note">
          <BanknoteIcon aria-hidden className="size-4 shrink-0" />
          {t('catalog.delivery.cod')}
        </p>
      )}
    </div>
  )
}

function ZoneList({ options }: { options: DeliveryOption[] }) {
  const { t } = useLocale()
  const { currency } = useStorefront().store
  return (
    <ul className="mt-0.5 flex flex-col gap-0.5" aria-label={t('catalog.delivery.options')}>
      {options.map((option, i) => {
        const freeOver = deliveryFreeOver(option, currency, t)
        return (
          <li key={`${option.zone}-${i}`} data-testid="delivery-option">
            <span className="font-medium text-sf-heading">{option.zone}</span>: {deliveryDays(option, t)} · {deliveryFee(option, currency, t)}
            {freeOver && <> · {freeOver}</>}
          </li>
        )
      })}
    </ul>
  )
}
