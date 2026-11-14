import type { ReactNode } from 'react'
import { PageHeader } from '@/components/common/page-header'
import { SectionTabs } from '@/features/inventory/components/inventory-tabs'
import { MARKETING_TABS } from '@/features/marketing/marketing'

export function MarketingHeader({ actions }: { actions?: ReactNode }) {
  return (
    <>
      <PageHeader
        title="Marketing"
        description="Post to Facebook and Instagram, list your products in shopping channels, and see which ads and posts bring visitors and orders."
        actions={actions}
      />
      <SectionTabs tabs={MARKETING_TABS} label="Marketing sections" />
    </>
  )
}
