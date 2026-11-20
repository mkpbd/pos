import { PageHeader } from '@/components/common/page-header'
import { useAuth } from '@/features/auth/use-auth'
import { SectionTabs } from '@/features/inventory/components/inventory-tabs'
import { aiSwitchedOn } from '@/features/online-catalog/ai-help/model'
import { STOREFRONT_AI_TAB, STOREFRONT_ASSISTANT_TAB, STOREFRONT_TABS } from '@/features/storefront/sections'

export function StorefrontHeader() {
  const me = useAuth()
  // AI2a / AI2b: the AI help and Assistant tabs only while AI is on for the organization (no placeholder UI);
  // SectionTabs also hides each tab without its permission (Assistant: storefront.manage).
  const tabs = aiSwitchedOn(me) ? [...STOREFRONT_TABS, STOREFRONT_AI_TAB, STOREFRONT_ASSISTANT_TAB] : STOREFRONT_TABS
  return (
    <>
      <PageHeader title="Online store" description="Your storefront's address, look and navigation." />
      <SectionTabs tabs={tabs} label="Online store sections" />
    </>
  )
}
