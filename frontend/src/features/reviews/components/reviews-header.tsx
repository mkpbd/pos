import type { ReactNode } from 'react'
import { PageHeader } from '@/components/common/page-header'
import { SectionTabs } from '@/features/inventory/components/inventory-tabs'
import type { SectionTab } from '@/features/inventory/sections'

/** Product reviews and shoppers' questions (P1b) share the Reviews entry; both need reviews.view. */
const REVIEWS_TABS: SectionTab[] = [
  { to: '/reviews', label: 'Reviews', permission: 'reviews.view' },
  { to: '/reviews/questions', label: 'Questions', permission: 'reviews.view' },
]

export function ReviewsHeader({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return (
    <>
      <PageHeader title={title} description={description} actions={actions} />
      <SectionTabs tabs={REVIEWS_TABS} label="Reviews and questions" />
    </>
  )
}
