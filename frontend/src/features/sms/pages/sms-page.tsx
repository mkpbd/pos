import { PageHeader } from '@/components/common/page-header'
import { ErrorState, LoadingState } from '@/components/common/state-views'
import { useCan } from '@/features/auth/use-auth'
import { SMS_PERMISSIONS, useSmsSettingsQuery, type SmsSettings } from '@/features/sms/api'
import { GatewayCard } from '@/features/sms/components/gateway-card'
import { MessageLogCard } from '@/features/sms/components/message-log-card'
import { TemplatesCard } from '@/features/sms/components/templates-card'
import { TestSmsCard } from '@/features/sms/components/test-sms-card'

const numberFormat = new Intl.NumberFormat('en-US')

function UsageLine({ usage }: { usage: SmsSettings['usage'] }) {
  return (
    <p className="text-sm text-muted-foreground" data-testid="sms-usage">
      This month: {numberFormat.format(usage.month_sent)} sent, {numberFormat.format(usage.month_failed)} failed, {numberFormat.format(usage.month_segments)} SMS parts
    </p>
  )
}

/** /settings/sms (sms.view): gateway, test message, order message templates and the message log (BD1a). Changes need sms.manage. */
export function SmsPage() {
  const can = useCan()
  const canManage = can(SMS_PERMISSIONS.manage)
  const settings = useSmsSettingsQuery()

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <PageHeader title="SMS" description="Order messages to customers and the codes for phone sign-in and checkout." />
      {settings.isPending ? (
        <LoadingState rows={6} label="Loading SMS settings" />
      ) : settings.error ? (
        <ErrorState error={settings.error} onRetry={() => settings.refetch()} />
      ) : (
        <>
          <UsageLine usage={settings.data.usage} />
          <GatewayCard settings={settings.data} canManage={canManage} />
          {canManage && <TestSmsCard settings={settings.data} />}
          <TemplatesCard settings={settings.data} canManage={canManage} />
        </>
      )}
      <MessageLogCard />
    </div>
  )
}
