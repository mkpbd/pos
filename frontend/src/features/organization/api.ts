import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { authKeys } from '@/features/auth/api'

export type Organization = {
  id: string
  name: string
  slug: string
  legal_name: string | null
  tax_number: string | null
  email: string | null
  phone: string | null
  address: string | null
  base_currency: string
  timezone: string
  tax_mode: 'exclusive' | 'inclusive'
  status: 'active' | 'suspended'
  settings: {
    receipt_header?: string | null
    receipt_footer?: string | null
    invoice_prefix?: string | null
    /** G1a: who must use two-factor sign-in. Absent = optional. */
    two_factor_policy?: TwoFactorPolicy
  }
  /** G1a: two-factor adoption, for users who can change the policy (organization.update). */
  two_factor_summary?: TwoFactorSummary
}

export type TwoFactorPolicy = 'optional' | 'admins' | 'everyone'

/** `required_missing`: users the current policy covers who have not set two-factor up yet. */
export type TwoFactorSummary = { users: number; enabled: number; required_missing: number }

export type OrganizationInput = Partial<Pick<Organization, 'name' | 'legal_name' | 'tax_number' | 'email' | 'phone' | 'address' | 'timezone' | 'tax_mode' | 'settings'>>

export const organizationKeys = { current: ['organization'] as const }

export function useOrganizationQuery() {
  return useQuery({
    queryKey: organizationKeys.current,
    queryFn: ({ signal }) => api.get<Organization>('/organization', { signal }).then((r) => r.data),
  })
}

export function useUpdateOrganizationMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: OrganizationInput) => api.patch<Organization>('/organization', input).then((r) => r.data),
    onSuccess: (organization) => {
      queryClient.setQueryData(organizationKeys.current, organization)
      void queryClient.invalidateQueries({ queryKey: authKeys.me })
    },
  })
}

/** R1: organization.settings.alerts — scheduled summaries, alerts and due (বাকি) reminders (GET/PATCH /settings/alerts). */
export type DueReminderSchedule = 'off' | 'weekly' | 'monthly'

export type AlertSettings = {
  daily_summary: boolean
  /** Local hour (0–23) from which the day's summary goes out. */
  daily_summary_hour: number
  /** 0 = off. */
  expiry_alert_days: number
  /** 0 = off. */
  register_open_hours: number
  due_reminders: DueReminderSchedule
  /** Smallest balance reminded (NUMERIC string). */
  due_reminder_min: string
  /** ISO weekday, 1 = Monday … 7 = Sunday. */
  due_reminder_weekday: number
}

export const alertSettingsKey = ['organization', 'alerts'] as const

export function useAlertSettingsQuery(enabled = true) {
  return useQuery({
    queryKey: alertSettingsKey,
    queryFn: ({ signal }) => api.get<AlertSettings>('/settings/alerts', { signal }).then((r) => r.data),
    enabled,
  })
}

export function useSaveAlertSettingsMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: Partial<AlertSettings>) => api.patch<AlertSettings>('/settings/alerts', input).then((r) => r.data),
    onSuccess: (settings) => queryClient.setQueryData(alertSettingsKey, settings),
  })
}
