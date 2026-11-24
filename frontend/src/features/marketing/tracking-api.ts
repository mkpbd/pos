import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'

/*
 * BD1c ad pixels, Conversions API and pasted tracking code (GET/PATCH /marketing/tracking, POST /marketing/tracking/test).
 * Reading needs marketing.view, changes marketing.manage; the <head> / </body> code also storefront.custom_html (`can_edit_code`).
 * The Conversions API access token is write-only: the server only says whether one is saved (`meta_capi_token_set`).
 */

export type CapiStatus = 'sent' | 'failed'

export type TrackingSettings = {
  meta_pixel_id: string | null
  meta_capi_enabled: boolean
  meta_capi_token_set: boolean
  meta_test_event_code: string | null
  ga4_measurement_id: string | null
  tiktok_pixel_id: string | null
  head_code: string | null
  body_code: string | null
  capi_last_status: CapiStatus | null
  capi_last_error: string | null
  capi_last_sent_at: string | null
  /** The user holds storefront.custom_html and may change the pasted code. */
  can_edit_code: boolean
  updated_at?: string | null
}

/** Any field; `meta_capi_token` omitted keeps the saved one, null clears it, a string replaces it. */
export type TrackingSettingsInput = Partial<
  Pick<TrackingSettings, 'meta_pixel_id' | 'meta_capi_enabled' | 'meta_test_event_code' | 'ga4_measurement_id' | 'tiktok_pixel_id' | 'head_code' | 'body_code'>
> & { meta_capi_token?: string | null }

export type TrackingTestResult = { status: CapiStatus; error: string | null }

export const trackingKeys = { settings: ['marketing', 'tracking'] as const }

export function useTrackingSettingsQuery() {
  return useQuery({
    queryKey: trackingKeys.settings,
    queryFn: ({ signal }) => api.get<TrackingSettings>('/marketing/tracking', { signal }).then((r) => r.data),
  })
}

export function useSaveTrackingSettingsMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: TrackingSettingsInput) => api.patch<TrackingSettings>('/marketing/tracking', input).then((r) => r.data),
    onSuccess: (saved) => queryClient.setQueryData(trackingKeys.settings, saved),
  })
}

/** Sends one PageView server event with the saved test event code; the last-sent status is refreshed afterwards. */
export function useSendTrackingTestMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<TrackingTestResult>('/marketing/tracking/test').then((r) => r.data),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: trackingKeys.settings }),
  })
}
