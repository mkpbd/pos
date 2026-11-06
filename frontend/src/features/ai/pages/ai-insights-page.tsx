import { useSearchParams } from 'react-router'
import { PageHeader } from '@/components/common/page-header'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AI_PERMISSIONS } from '@/features/ai/api'
import { AskPanel } from '@/features/ai/components/ask-panel'
import { BusinessInsights } from '@/features/ai/components/business-insights'
import { CustomerInsights } from '@/features/ai/components/customer-insights'
import { useCan } from '@/features/auth/use-auth'

type TabKey = 'ask' | 'business' | 'customers'

const TABS: { key: TabKey; label: string; permission: string }[] = [
  { key: 'ask', label: 'Ask', permission: AI_PERMISSIONS.ask },
  { key: 'business', label: 'Business insights', permission: AI_PERMISSIONS.insights },
  { key: 'customers', label: 'Customers', permission: AI_PERMISSIONS.insights },
]

/** /ai — Ask AI (ai.ask), business and customer insights (ai.insights). The tab lives in the address. */
export function AiInsightsPage() {
  const can = useCan()
  const [search, setSearch] = useSearchParams()
  const tabs = TABS.filter((t) => can(t.permission))
  const requested = search.get('tab')
  const active = tabs.find((t) => t.key === requested)?.key ?? tabs[0]?.key ?? 'ask'

  const select = (key: string) => {
    const next = new URLSearchParams(search)
    next.set('tab', key)
    setSearch(next, { replace: true })
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="AI Insights" description="Plain-language answers and summaries from your own sales, stock and customer figures. AI never changes your data." />
      <Tabs value={active} onValueChange={select}>
        {tabs.length > 1 && (
          <TabsList aria-label="AI Insights sections" className="max-w-full overflow-x-auto">
            {tabs.map((t) => <TabsTrigger key={t.key} value={t.key}>{t.label}</TabsTrigger>)}
          </TabsList>
        )}
        {tabs.map((t) => (
          // Ask stays mounted so the last answer survives a look at the other tabs.
          <TabsContent key={t.key} value={t.key} className="pt-3 data-[state=inactive]:hidden" forceMount={t.key === 'ask' ? true : undefined}>
            {t.key === 'ask' ? <AskPanel /> : t.key === 'business' ? <BusinessInsights /> : <CustomerInsights />}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
