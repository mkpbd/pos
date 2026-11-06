import { PageHeader } from '@/components/common/page-header'
import { SectionTabs } from '@/features/inventory/components/inventory-tabs'
import { PURCHASING_TABS } from '@/features/inventory/sections'
import { ApprovalSettingsCard } from '@/features/procurement/components/approval-settings-card'

/** Purchasing → Settings (organization-wide purchasing settings). */
export function PurchasingSettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Purchasing" description="Organization-wide purchasing settings." />
      <SectionTabs tabs={PURCHASING_TABS} label="Purchasing sections" />
      <div className="max-w-3xl">
        <ApprovalSettingsCard />
      </div>
    </div>
  )
}
