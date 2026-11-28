import { API_BASE, ApiError } from '@/lib/api/client'
import { MEDIA_ACCEPT, MEDIA_MAX_BYTES, type MediaItem } from '@/features/media/api'
import { useSessionStore } from '@/stores/session-store'
import type { Background, BuilderContent, BuilderNode, ResponsiveStyle } from '@/storefront/builder/types'
import { CASCADE } from './inspector/style-model'
import { findNode, setNode } from './tree'

/*
 * B10 picture drop (contract §1): a picture file dropped on an image element or on a node with a
 * background picture in the canvas goes to the media library (POST /media, the existing upload
 * API) and the node's `media_id` is set — one undo step. The upload runs over XMLHttpRequest so
 * its progress can be shown on the node (fetch has no upload progress); it sends the same headers
 * as the API client (XSRF token, the active branch).
 */

export type DropTarget = 'image' | 'background'

/** Why a file can't be used as a picture (null: fine). Mirrors the API's rules (JPEG, PNG, WebP, GIF up to 5 MB). */
export function pictureFileProblem(file: { name: string; type: string; size: number }): string | null {
  if (!MEDIA_ACCEPT.split(',').includes(file.type)) return `“${file.name}” isn’t a picture we can use. Use a JPEG, PNG, WebP, GIF or AVIF file.`
  if (file.size > MEDIA_MAX_BYTES) return `“${file.name}” is larger than 5 MB. Make it smaller and try again.`
  return null
}

function readCookie(name: string): string | null {
  const match = document.cookie.split('; ').find((row) => row.startsWith(`${name}=`))
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null
}

/** B21: `alt` is stored with the picture in the media library. */
export type UploadOptions = { onProgress?: (fraction: number) => void; signal?: AbortSignal; alt?: string }

/** Uploads one picture to the media library; `onProgress` gets 0–1 while the bytes go up. */
export function uploadPicture(file: File, options: UploadOptions = {}): Promise<MediaItem> {
  return new Promise<MediaItem>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_BASE}/media`)
    xhr.withCredentials = true
    xhr.setRequestHeader('Accept', 'application/json')
    xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest')
    const xsrf = readCookie('XSRF-TOKEN')
    if (xsrf) xhr.setRequestHeader('X-XSRF-TOKEN', xsrf)
    const branch = useSessionStore.getState().activeBranchId
    if (branch) xhr.setRequestHeader('X-Branch-Id', branch)
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) options.onProgress?.(Math.min(1, event.loaded / event.total))
    }
    xhr.onerror = () => reject(new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection.'))
    xhr.onabort = () => reject(new DOMException('The upload was stopped.', 'AbortError'))
    xhr.onload = () => {
      let payload: unknown
      try {
        payload = JSON.parse(xhr.responseText)
      } catch {
        reject(new ApiError(xhr.status, 'INVALID_RESPONSE', 'The server returned an unexpected response.'))
        return
      }
      const body = payload as { success?: boolean; data?: MediaItem; error?: { code: string; message: string; details?: Record<string, unknown> } }
      if (body.success === true && body.data) resolve(body.data)
      else reject(new ApiError(xhr.status, body.error?.code ?? 'UPLOAD_FAILED', body.error?.message ?? 'The picture couldn’t be uploaded.', body.error?.details ?? {}))
    }
    options.signal?.addEventListener('abort', () => xhr.abort(), { once: true })
    const body = new FormData()
    body.append('file', file)
    if (options.alt) body.append('alt', options.alt)
    xhr.send(body)
  })
}

/** A plain message for a failed upload (the server's field message when it gave one). */
export function uploadErrorMessage(error: unknown, fileName: string): string {
  if (error instanceof ApiError) {
    const field = error.fieldErrors.file?.[0]
    if (field) return `“${fileName}”: ${field}`
    if (error.status === 403) return 'You don’t have permission to add pictures to the media library.'
    if (error.status === 0) return 'The picture couldn’t be uploaded: the server can’t be reached. Check your connection.'
    return `“${fileName}” couldn’t be uploaded: ${error.message}`
  }
  return `“${fileName}” couldn’t be uploaded. Try again.`
}

/** Where a node's background picture is set for a device (the narrowest breakpoint that sets one), or null. */
function backgroundBreakpoint(style: ResponsiveStyle | undefined, breakpoint: 'base' | 'tablet' | 'mobile'): 'base' | 'tablet' | 'mobile' | null {
  for (const bp of CASCADE[breakpoint]) {
    const background = style?.[bp]?.background
    if (background?.type === 'image' && background.image) return bp
  }
  return null
}

/** What a dropped picture would replace on a node: its image, its background picture, or nothing. */
export function dropTargetOf(node: BuilderNode | null | undefined, breakpoint: 'base' | 'tablet' | 'mobile' = 'base'): DropTarget | null {
  if (!node) return null
  if (node.type === 'image') return 'image'
  if (node.type === 'column' || 'style' in node) return backgroundBreakpoint((node as { style?: ResponsiveStyle }).style, breakpoint) ? 'background' : null
  return null
}

/**
 * The content with the node's picture replaced by `mediaId`: an image element's `media_id`, or
 * the background picture where it is set for the device. Unchanged when the node has neither.
 */
export function setNodePicture(content: BuilderContent, id: string, mediaId: string, breakpoint: 'base' | 'tablet' | 'mobile' = 'base'): BuilderContent {
  const info = findNode(content, id)
  if (!info) return content
  const node = info.node
  if (node.type === 'image') {
    const props = node.props as { media_id: string | null }
    return props.media_id === mediaId ? content : setNode(content, { ...node, props: { ...props, media_id: mediaId } } as BuilderNode)
  }
  const style = (node as { style?: ResponsiveStyle }).style
  const bp = backgroundBreakpoint(style, breakpoint)
  if (!style || !bp) return content
  const background = style[bp]!.background as Background
  if (background.image!.media_id === mediaId) return content
  const next: ResponsiveStyle = { ...style, [bp]: { ...style[bp], background: { ...background, image: { ...background.image!, media_id: mediaId } } } }
  return setNode(content, { ...node, style: next } as BuilderNode)
}
