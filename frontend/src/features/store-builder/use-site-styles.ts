import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { storefrontKeys, usePublishThemeMutation, useSaveThemeDraftMutation, useThemeDraftQuery, type ThemeDraft, type ThemeSettings } from '@/features/storefront/api'
import { ApiError } from '@/lib/api/client'

/*
 * Site styles in the store builder (B3): the theme draft (GET /storefront/theme/draft). Every
 * change shows on the canvas at once (the editor sends the settings with the `theme` canvas
 * message) and is saved to the theme draft 800 ms later (PUT with the revision; a 409 loads the
 * other version). The live store changes only when the site styles are published.
 */

export const SITE_STYLES_SAVE_DELAY = 800

export type SiteStylesStatus = 'idle' | 'saving' | 'saved' | 'error'

export type SiteStyles = {
  /** The settings to show (unsaved edits first), or null until the draft is loaded. */
  settings: ThemeSettings | null
  draft: ThemeDraft | undefined
  loading: boolean
  loadError: boolean
  status: SiteStylesStatus
  message: string | null
  errors: Record<string, string>
  change: (next: ThemeSettings) => void
  flush: () => Promise<boolean>
  publish: () => Promise<boolean>
  publishing: boolean
}

/** Validation errors `settings.colors.primary` → `colors.primary` (the panel's paths), first message each. */
function fieldErrors(error: ApiError): Record<string, string> {
  return Object.fromEntries(Object.entries(error.fieldErrors).map(([key, messages]) => [key.replace(/^settings\./, ''), messages[0] ?? 'Invalid value.']))
}

export function useSiteStyles(delay = SITE_STYLES_SAVE_DELAY): SiteStyles {
  const queryClient = useQueryClient()
  const query = useThemeDraftQuery()
  const save = useSaveThemeDraftMutation()
  const publishMutation = usePublishThemeMutation()
  const [local, setLocal] = useState<ThemeSettings | null>(null)
  const [status, setStatus] = useState<SiteStylesStatus>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const pending = useRef<ThemeSettings | null>(null)
  const inFlight = useRef<Promise<boolean> | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mutate = save.mutateAsync

  const flush = useCallback(async (): Promise<boolean> => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (inFlight.current) await inFlight.current
    const next = pending.current
    if (!next) return true
    const run = (async () => {
      setStatus('saving')
      const revision = queryClient.getQueryData<ThemeDraft>(storefrontKeys.themeDraft)?.draft_revision ?? 0
      try {
        await mutate({ revision, settings: next })
        if (pending.current === next) {
          pending.current = null
          // The saved (normalized) draft from the server takes over again.
          setLocal(null)
        }
        setErrors({})
        setMessage(null)
        setStatus('saved')
        return true
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          pending.current = null
          setLocal(null)
          setStatus('error')
          setMessage('The site styles were changed somewhere else; that version is loaded now.')
          toast.warning('The site styles were changed in another tab or by someone else. Their version is loaded.')
          await queryClient.invalidateQueries({ queryKey: storefrontKeys.themeDraft })
        } else if (error instanceof ApiError && error.status === 422) {
          setErrors(fieldErrors(error))
          setStatus('error')
          setMessage('Some values aren’t allowed; fix the marked fields.')
        } else {
          setStatus('error')
          setMessage(error instanceof Error ? error.message : 'Could not save the site styles.')
        }
        return false
      }
    })()
    inFlight.current = run
    try {
      return await run
    } finally {
      inFlight.current = null
    }
  }, [mutate, queryClient])

  const change = useCallback(
    (next: ThemeSettings) => {
      setLocal(next)
      pending.current = next
      setStatus('idle')
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(), delay)
    },
    [delay, flush],
  )

  useEffect(
    () => () => {
      // Leaving the editor: save what is still waiting.
      if (timer.current) clearTimeout(timer.current)
      if (pending.current) void flush()
    },
    [flush],
  )

  const publishAsync = publishMutation.mutateAsync
  const publish = useCallback(async () => {
    const saved = await flush()
    if (!saved) return false
    try {
      const result = await publishAsync(null)
      toast.success(result?.published ? `Site styles published — version ${result.published.number} is live.` : 'Site styles published.')
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not publish the site styles.')
      return false
    }
  }, [flush, publishAsync])

  return {
    settings: local ?? query.data?.settings ?? null,
    draft: query.data,
    loading: query.isPending,
    loadError: query.isError,
    status,
    message,
    errors,
    change,
    flush,
    publish,
    publishing: publishMutation.isPending,
  }
}
