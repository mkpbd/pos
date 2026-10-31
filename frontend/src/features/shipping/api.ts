import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'

export type Division = { id: number; name: string; name_bn?: string }
export type District = { id: number; division_id: number; name: string; name_bn?: string }

export type ShippingMethod = {
  id: string
  zone_id?: string
  name: string
  description: string | null
  fee: string
  /** Free when the cart total reaches this amount; null = never free. */
  free_over: string | null
  cod_allowed: boolean
  cod_fee: string
  eta_min_days: number
  eta_max_days: number
  is_active: boolean
  sort_order: number
}

export type ShippingZone = {
  id: string
  name: string
  is_active: boolean
  sort_order: number
  districts: { id: number; name: string }[]
  methods: ShippingMethod[]
}

export type ZoneInput = { name: string; is_active: boolean; sort_order: number; district_ids: number[] }

export type MethodInput = Omit<ShippingMethod, 'id' | 'zone_id'>

export const shippingKeys = {
  all: ['shipping'] as const,
  zones: ['shipping', 'zones'] as const,
  divisions: ['geography', 'divisions'] as const,
  districts: ['geography', 'districts'] as const,
}

export function useShippingZonesQuery() {
  return useQuery({
    queryKey: shippingKeys.zones,
    queryFn: ({ signal }) => api.get<ShippingZone[]>('/shipping/zones', { signal }).then((r) => r.data),
  })
}

/** Bangladesh reference data: the same for everyone and rarely changing. */
export function useDivisionsQuery() {
  return useQuery({
    queryKey: shippingKeys.divisions,
    queryFn: ({ signal }) => api.get<Division[]>('/geography/divisions', { signal }).then((r) => r.data),
    staleTime: Infinity,
  })
}

export function useDistrictsQuery() {
  return useQuery({
    queryKey: shippingKeys.districts,
    queryFn: ({ signal }) => api.get<District[]>('/geography/districts', { signal }).then((r) => r.data),
    staleTime: Infinity,
  })
}

function useInvalidateZones() {
  const queryClient = useQueryClient()
  return () => void queryClient.invalidateQueries({ queryKey: shippingKeys.all })
}

export function useSaveZoneMutation() {
  const invalidate = useInvalidateZones()
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: ZoneInput }) =>
      (id ? api.patch<ShippingZone>(`/shipping/zones/${id}`, input) : api.post<ShippingZone>('/shipping/zones', input)).then((r) => r.data),
    onSuccess: invalidate,
    // DISTRICT_IN_OTHER_ZONE: another zone took a district meanwhile, so refresh the map.
    onError: invalidate,
  })
}

export function useDeleteZoneMutation() {
  const invalidate = useInvalidateZones()
  return useMutation({ mutationFn: (id: string) => api.delete(`/shipping/zones/${id}`), onSuccess: invalidate })
}

export function useSaveMethodMutation() {
  const invalidate = useInvalidateZones()
  return useMutation({
    mutationFn: ({ zoneId, id, input }: { zoneId: string; id?: string; input: MethodInput }) =>
      (id ? api.patch<ShippingMethod>(`/shipping/methods/${id}`, input) : api.post<ShippingMethod>(`/shipping/zones/${zoneId}/methods`, input)).then((r) => r.data),
    onSuccess: invalidate,
  })
}

export function useDeleteMethodMutation() {
  const invalidate = useInvalidateZones()
  return useMutation({ mutationFn: (id: string) => api.delete(`/shipping/methods/${id}`), onSuccess: invalidate })
}
