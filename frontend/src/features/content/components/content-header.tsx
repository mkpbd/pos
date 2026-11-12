import type { ReactNode } from 'react'
import { PageHeader } from '@/components/common/page-header'
import { SectionTabs } from '@/features/inventory/components/inventory-tabs'
import type { SectionTab } from '@/features/inventory/sections'

/** Every tab names its permission: form submissions (B8b) are open to `forms.view` without `cms.manage`. */
const CONTENT_TABS: SectionTab[] = [
  { to: '/content/pages', label: 'Pages', permission: 'cms.manage' },
  { to: '/content/blog', label: 'Blog', permission: 'cms.manage' },
  { to: '/content/faq', label: 'FAQ', permission: 'cms.manage' },
  { to: '/content/messages', label: 'Messages', permission: 'cms.manage' },
  { to: '/content/forms', label: 'Form submissions', permission: 'forms.view' },
  { to: '/content/newsletter', label: 'Newsletter', permission: 'cms.manage' },
]

export function ContentHeader({ actions }: { actions?: ReactNode }) {
  return (
    <>
      <PageHeader title="Content" description="Pages, blog, FAQ, contact messages, form submissions and newsletter sign-ups of your online store." actions={actions} />
      <SectionTabs tabs={CONTENT_TABS} label="Content sections" />
    </>
  )
}
