import { PageHeader } from '@/components/common/page-header'
import { SectionTabs } from '@/features/inventory/components/inventory-tabs'
import { INVENTORY_TABS } from '@/features/inventory/sections'
import { ReplenishmentSettingsCard } from '@/features/supply-chain/components/replenishment-settings-card'

/** Inventory → Settings (organization-wide stock settings). */
export function InventorySettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Inventory" description="Organization-wide stock settings." />
      <SectionTabs tabs={INVENTORY_TABS} label="Inventory sections" />
      <div className="max-w-3xl">
        <ReplenishmentSettingsCard />
      </div>
    </div>
  )
}
