import type { ReactNode } from 'react'
import { PageHeader } from '@/components/common/page-header'
import { SectionTabs } from '@/features/inventory/components/inventory-tabs'
import type { SectionTab } from '@/features/inventory/sections'

const CONTENT_TABS: SectionTab[] = [
  { to: '/content/pages', label: 'Pages' },
  { to: '/content/faq', label: 'FAQ' },
  { to: '/content/messages', label: 'Messages' },
  { to: '/content/newsletter', label: 'Newsletter' },
]

export function ContentHeader({ actions }: { actions?: ReactNode }) {
  return (
    <>
      <PageHeader title="Content" description="Pages, FAQ, contact messages and newsletter sign-ups of your online store." actions={actions} />
      <SectionTabs tabs={CONTENT_TABS} label="Content sections" />
    </>
  )
}
