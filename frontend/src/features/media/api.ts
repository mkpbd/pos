import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, toPaginated } from '@/lib/api/client'

export type MediaItem = {
  id: string
  url: string
  srcset: string
  width: number
  height: number
  alt: string | null
  /** B11: focal point in percent (`object-position`); null = centre. Optional for older fixtures. */
  focal?: MediaFocal | null
  /** B11: the picture an edited copy was made from. */
  edited_from_id?: string | null
  original_name: string
  mime_type: string
  size: number
  created_at: string | null
}

export type MediaFocal = { x: number; y: number }

/** B11: `POST /media/{id}/edit` — see features/media/editor/geometry.ts for how the editor builds it. */
export type MediaEditInput = {
  crop?: { x: number; y: number; w: number; h: number }
  rotate: 0 | 90 | 180 | 270
  flip_h: boolean
  flip_v: boolean
  brightness: number
  contrast: number
  saturation: number
  focal_x?: number
  focal_y?: number
  mode: 'copy' | 'replace'
  confirm_replace?: boolean
}

export type MediaUsage = { in_use: boolean; places: string[] }

/** GIFs may be animated and are not edited. */
export const isEditable = (item: Pick<MediaItem, 'mime_type'>) => ['image/jpeg', 'image/png', 'image/webp'].includes(item.mime_type)

/** Accepted by the API: JPEG, PNG, WebP, GIF, AVIF (B22a: when the server can read it) up to 5 MB. */
export const MEDIA_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/avif'
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

/** B11: focal point only (no new file); `null` resets it to the centre. */
export function useUpdateMediaFocalMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, focal }: { id: string; focal: MediaFocal | null }) =>
      api.patch<MediaItem>(`/media/${id}`, { focal_x: focal?.x ?? null, focal_y: focal?.y ?? null }).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: mediaKeys.all }),
  })
}

/** B11: where a picture is used (asked before "Replace the original"). */
export function useMediaUsageQuery(id: string, enabled: boolean) {
  return useQuery({
    queryKey: [...mediaKeys.all, 'usage', id] as const,
    queryFn: ({ signal }) => api.get<MediaUsage>(`/media/${id}/usage`, { signal }).then((r) => r.data),
    enabled,
  })
}

/** B11: saves an edit as a new copy (201) or over the original (200). */
export function useEditMediaMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: MediaEditInput }) => api.post<MediaItem>(`/media/${id}/edit`, input).then((r) => r.data),
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
  if (!MEDIA_ACCEPT.split(',').includes(file.type)) return `${file.name}: only JPEG, PNG, WebP, GIF or AVIF images.`
  if (file.size > MEDIA_MAX_BYTES) return `${file.name}: larger than 5 MB.`
  return null
}
