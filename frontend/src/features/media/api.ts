import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, toPaginated } from '@/lib/api/client'

export type MediaItem = {
  id: string
  url: string
  srcset: string
  width: number
  height: number
  alt: string | null
  original_name: string
  mime_type: string
  size: number
  created_at: string | null
}

/** Accepted by the API: JPEG, PNG, WebP, GIF up to 5 MB. */
export const MEDIA_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif'
export const MEDIA_MAX_BYTES = 5 * 1024 * 1024

export const mediaKeys = {
  all: ['media'] as const,
  list: (params: { page: number; search?: string; per_page?: number }) => ['media', 'list', params] as const,
}

export function useMediaQuery(params: { page: number; search?: string; per_page?: number }) {
  return useQuery({
    queryKey: mediaKeys.list(params),
    queryFn: ({ signal }) => api.get<MediaItem[]>('/media', { signal, query: { ...params, sort: '-created_at' } }).then(toPaginated),
    placeholderData: (previous) => previous,
  })
}

/**
 * Media items by id (`GET /media?ids=`, max. 100) for showing what a setting points at.
 */
export function useMediaLookup(ids: string[]) {
  const unique = [...new Set(ids)].sort()
  const query = useQuery({
    queryKey: [...mediaKeys.all, 'lookup', unique] as const,
    queryFn: ({ signal }) => api.get<MediaItem[]>('/media', { signal, query: { ids: unique.join(','), per_page: 100 } }).then(toPaginated),
    enabled: unique.length > 0,
    staleTime: 60_000,
  })
  const byId = new Map((query.data?.items ?? []).map((m) => [m.id, m]))
  return { byId, isPending: unique.length > 0 && query.isPending }
}

export function useUploadMediaMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ file, alt }: { file: File; alt?: string }) => {
      const body = new FormData()
      body.append('file', file)
      if (alt) body.append('alt', alt)
      return api.post<MediaItem>('/media', body).then((r) => r.data)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: mediaKeys.all }),
  })
}

export function useUpdateMediaAltMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, alt }: { id: string; alt: string | null }) => api.patch<MediaItem>(`/media/${id}`, { alt }).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: mediaKeys.all }),
  })
}

export function useDeleteMediaMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => api.delete(`/media/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: mediaKeys.all }),
  })
}

/** "1.2 MB", "340 KB" */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/** Client-side pre-check mirroring the API rules, so obviously wrong files never upload. */
export function rejectReason(file: File): string | null {
  if (!MEDIA_ACCEPT.split(',').includes(file.type)) return `${file.name}: only JPEG, PNG, WebP or GIF images.`
  if (file.size > MEDIA_MAX_BYTES) return `${file.name}: larger than 5 MB.`
  return null
}
