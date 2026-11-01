import { SectionTabs } from '@/features/inventory/components/inventory-tabs'
import type { SectionTab } from '@/features/inventory/sections'

const SHIPPING_TABS: SectionTab[] = [
  { to: '/storefront/shipping', label: 'Zones & methods' },
  { to: '/storefront/shipping/couriers', label: 'Couriers' },
]

/** Zones/methods and couriers: the two halves of the shipping settings, each with its own URL. */
export function ShippingTabs() {
  return <SectionTabs tabs={SHIPPING_TABS} label="Shipping settings" />
}
