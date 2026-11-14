import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { API_BASE, api, toPaginated, type Paginated } from '@/lib/api/client'

/*
 * P2b Social (backend contract §3–§6): the Meta settings (sandbox | live), the connected Facebook
 * Page and Instagram account, posts and caption suggestions. Reading needs social.view, every
 * change social.manage. The app secret is write-only — the API only says whether one is saved.
 */

export const SOCIAL_VIEW = 'social.view'
export const SOCIAL_MANAGE = 'social.manage'

export type SocialMode = 'sandbox' | 'live'

export type SocialSettings = {
  mode: SocialMode
  meta_app_id: string | null
  /** Whether an app secret is saved; the secret itself never leaves the server. */
  secret_set: boolean
  graph_version: string
  /** The address to add under "Valid OAuth Redirect URIs" in the Meta app. */
  redirect_uri: string | null
  /** App id and secret are both set, so live mode can be used. */
  live_ready: boolean
  updated_at: string | null
}

export type SocialSettingsInput = {
  mode?: SocialMode
  meta_app_id?: string | null
  /** Write-only: omitted keeps the saved secret, null or "" clears it. */
  meta_app_secret?: string | null
  graph_version?: string
}

export type InstagramAccount = { id: string; username: string; picture_url?: string | null }
export type FacebookPage = { id: string; name: string; picture_url?: string | null }
export type FacebookPageChoice = { id: string; name: string; instagram: InstagramAccount | null }

export type SocialAccounts = {
  mode: SocialMode
  connected: boolean
  /** A simulated (practice) connection: nothing reaches Facebook or Instagram. */
  sandbox: boolean
  page: FacebookPage | null
  instagram: InstagramAccount | null
  /** The Pages the connected Facebook account manages (to switch between them). */
  pages: FacebookPageChoice[]
  connected_at: string | null
  connected_by: { id: string; name: string } | null
}

export type SocialTarget = 'facebook' | 'instagram'
export const SOCIAL_TARGETS: readonly SocialTarget[] = ['facebook', 'instagram']

export type SocialPostStatus = 'draft' | 'scheduled' | 'publishing' | 'published' | 'partially_published' | 'failed'
export const SOCIAL_POST_STATUSES: readonly SocialPostStatus[] = ['draft', 'scheduled', 'publishing', 'published', 'partially_published', 'failed']

export type SocialPostAction = 'edit' | 'publish' | 'cancel' | 'retry' | 'delete'

export type SocialResultStatus = 'pending' | 'publishing' | 'published' | 'failed'

/** One network's outcome; the API sends one per target, always. */
export type SocialPostResult = {
  target: SocialTarget
  status: SocialResultStatus
  remote_id: string | null
  permalink: string | null
  /** `message` is plain words from the server; the screen maps known codes to its own. */
  error: { code: string; message: string } | null
  /** The P2a short link added to this network's caption (counts visits and orders). */
  short_link: { code: string; url: string | null } | null
  published_at: string | null
  /** Made in practice mode: the link is pretend. */
  sandbox: boolean
}

/** A photo of the post: a product photo or a media-library image (`/storage/…` address). */
export type SocialPostMedia = { id: string; kind: 'product_image' | 'media'; url: string }

export type SocialPost = {
  id: string
  caption: string
  targets: SocialTarget[]
  image_ids: string[]
  media_ids: string[]
  /** In posting order: product photos first, then library images. */
  media: SocialPostMedia[]
  /** Store path; null = the product's page (when there is a product), else no link. */
  link_url: string | null
  product: { id: string; name: string } | null
  campaign: { id: string; name: string } | null
  status: SocialPostStatus
  scheduled_at: string | null
  published_at: string | null
  results: SocialPostResult[]
  /** What the caller may do with the post now (drives the buttons). */
  allowed_actions: SocialPostAction[]
  created_by: { id: string; name: string } | null
  created_at: string | null
  updated_at: string | null
}

export type SocialPostInput = {
  caption: string
  targets: SocialTarget[]
  /** Product photo ids, then media library ids: together at most 10 (Instagram needs one). */
  image_ids: string[]
  media_ids: string[]
  link_url: string | null
  product_id: string | null
  campaign_id: string | null
  /** ISO 8601 with offset; null = a draft. */
  scheduled_at: string | null
}

export type SocialPostsParams = { page: number; per_page?: number; status?: SocialPostStatus; search?: string }

export type CaptionLanguage = 'en' | 'bn'
export type CaptionTone = 'friendly' | 'festive' | 'short'
/** Why ready-made captions were given instead of AI ones. */
export type CaptionFallbackReason = 'disabled' | 'unavailable' | 'budget_exceeded' | 'invalid_output'
export type CaptionSuggestions = { captions: string[]; source: 'ai' | 'template'; reason: CaptionFallbackReason | null }

/** Browser navigation (not fetch): sandbox comes straight back, live goes through Facebook's login. */
export const SOCIAL_CONNECT_URL = `${API_BASE}/social/meta/connect`

export const socialKeys = {
  all: ['social'] as const,
  settings: ['social', 'settings'] as const,
  accounts: ['social', 'accounts'] as const,
  posts: ['social', 'posts'] as const,
  postList: (params: SocialPostsParams) => ['social', 'posts', 'list', params] as const,
  post: (id: string) => ['social', 'posts', 'detail', id] as const,
}

export function useSocialSettingsQuery() {
  return useQuery({
    queryKey: socialKeys.settings,
    queryFn: ({ signal }) => api.get<SocialSettings>('/social/settings', { signal }).then((r) => r.data),
  })
}

export function useSaveSocialSettingsMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: SocialSettingsInput) => api.patch<SocialSettings>('/social/settings', input).then((r) => r.data),
    onSuccess: (settings) => {
      queryClient.setQueryData(socialKeys.settings, settings)
      // Changing the mode disconnects the account.
      void queryClient.invalidateQueries({ queryKey: socialKeys.accounts })
    },
  })
}

export function useSocialAccountsQuery() {
  return useQuery({
    queryKey: socialKeys.accounts,
    queryFn: ({ signal }) => api.get<SocialAccounts>('/social/accounts', { signal }).then((r) => r.data),
  })
}

export function useSelectSocialPageMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (pageId: string) => api.post<SocialAccounts>('/social/accounts/select', { page_id: pageId }).then((r) => r.data),
    onSuccess: (accounts) => queryClient.setQueryData(socialKeys.accounts, accounts),
  })
}

export function useDisconnectSocialMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.delete('/social/accounts'),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: socialKeys.accounts }),
  })
}

/** Whether the post is still on its way (the list and the watcher poll meanwhile). */
export const isPublishing = (post: Pick<SocialPost, 'status'>) => post.status === 'publishing'

export function useSocialPostsQuery(params: SocialPostsParams) {
  return useQuery<Paginated<SocialPost>>({
    queryKey: socialKeys.postList(params),
    queryFn: ({ signal }) => api.get<SocialPost[]>('/social/posts', { signal, query: params }).then(toPaginated),
    placeholderData: (previous) => previous,
    // Posts being published (by a worker or the scheduler) settle on their own.
    refetchInterval: (query) => (query.state.data?.items.some(isPublishing) ? 4000 : false),
  })
}

/**
 * Posts published with a queue worker come back `publishing`: each watched post is fetched
 * (GET /social/posts/{id}) every 2.5 s until it settles.
 */
export function useWatchedPostsQueries(ids: string[]) {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: socialKeys.post(id),
      queryFn: ({ signal }: { signal: AbortSignal }) => api.get<SocialPost>(`/social/posts/${id}`, { signal }).then((r) => r.data),
      refetchInterval: (query: { state: { data?: SocialPost } }) => (query.state.data && !isPublishing(query.state.data) ? false : 2500),
    })),
  })
}

function usePostCache() {
  const queryClient = useQueryClient()
  return (post?: SocialPost) => {
    if (post) queryClient.setQueryData(socialKeys.post(post.id), post)
    void queryClient.invalidateQueries({ queryKey: [...socialKeys.posts, 'list'] })
  }
}

/** Creates (POST) or changes (PATCH) a post; with `publish` it is then posted at once. */
export function useSubmitSocialPostMutation() {
  const update = usePostCache()
  return useMutation({
    mutationFn: async ({ id, input, publish }: { id?: string; input: SocialPostInput; publish: boolean }) => {
      const saved = (await (id ? api.patch<SocialPost>(`/social/posts/${id}`, input) : api.post<SocialPost>('/social/posts', input))).data
      if (!publish) return { saved, published: null }
      try {
        const published = (await api.post<SocialPost>(`/social/posts/${saved.id}/publish`)).data
        return { saved, published }
      } catch (error) {
        // The post is saved as a draft: say so with the failure.
        throw Object.assign(error instanceof Error ? error : new Error('Posting failed.'), { savedPost: saved })
      }
    },
    onSuccess: ({ saved, published }) => update(published ?? saved),
    onError: (error) => update((error as { savedPost?: SocialPost }).savedPost),
  })
}

/** publish | cancel | retry on one post. */
export function useSocialPostActionMutation() {
  const update = usePostCache()
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'publish' | 'cancel' | 'retry' }) => api.post<SocialPost>(`/social/posts/${id}/${action}`).then((r) => r.data),
    onSuccess: (post) => update(post),
    onError: () => update(),
  })
}

export function useDeleteSocialPostMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/social/posts/${id}`),
    onSuccess: (_, id) => {
      queryClient.removeQueries({ queryKey: socialKeys.post(id) })
      void queryClient.invalidateQueries({ queryKey: [...socialKeys.posts, 'list'] })
    },
  })
}

export function useCaptionSuggestionsMutation() {
  return useMutation({
    mutationFn: (input: { product_id: string; language: CaptionLanguage; tone: CaptionTone }) =>
      api.post<CaptionSuggestions>('/social/caption-suggestions', input).then((r) => r.data),
  })
}
