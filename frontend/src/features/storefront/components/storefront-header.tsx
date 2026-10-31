import { PageHeader } from '@/components/common/page-header'
import { SectionTabs } from '@/features/inventory/components/inventory-tabs'
import { STOREFRONT_TABS } from '@/features/storefront/sections'

export function StorefrontHeader() {
  return (
    <>
      <PageHeader title="Online store" description="Your storefront's address, look and navigation." />
      <SectionTabs tabs={STOREFRONT_TABS} label="Online store sections" />
    </>
  )
}
