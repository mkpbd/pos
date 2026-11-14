import { storePathProblem } from '@/features/marketing/marketing'
import {
  SOCIAL_TARGETS,
  type CaptionFallbackReason,
  type SocialPost,
  type SocialPostInput,
  type SocialPostMedia,
  type SocialPostResult,
  type SocialPostStatus,
  type SocialTarget,
} from '@/features/marketing/social-api'
import { fromZonedInput, toZonedInput } from '@/features/promotions/zoned-time'
import { ApiError } from '@/lib/api/client'

/** P2b: plain-language rules and words for posting to Facebook and Instagram. */

export const CAPTION_MAX = 2200
export const MAX_PHOTOS = 10
export const INSTAGRAM_MAX_HASHTAGS = 30

export const TARGET_LABELS: Record<SocialTarget, string> = { facebook: 'Facebook', instagram: 'Instagram' }

type BadgeVariant = 'outline' | 'info' | 'warning' | 'success' | 'destructive' | 'soft'

export const POST_STATUS: Record<SocialPostStatus, { label: string; variant: BadgeVariant }> = {
  draft: { label: 'Draft', variant: 'outline' },
  scheduled: { label: 'Scheduled', variant: 'info' },
  publishing: { label: 'Posting…', variant: 'soft' },
  published: { label: 'Posted', variant: 'success' },
  partially_published: { label: 'Partly posted', variant: 'warning' },
  failed: { label: 'Failed', variant: 'destructive' },
}

/** Status filter of the post list ("" = every post). */
export const POST_FILTERS: { value: SocialPostStatus | ''; label: string }[] = [
  { value: '', label: 'All posts' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'draft', label: 'Drafts' },
  { value: 'published', label: 'Posted' },
  { value: 'partially_published', label: 'Partly posted' },
  { value: 'failed', label: 'Failed' },
]

/** "Facebook", "Facebook and Instagram". */
export function targetList(targets: readonly SocialTarget[]): string {
  return targets.map((t) => TARGET_LABELS[t]).join(' and ')
}

/** Characters as Facebook and Instagram count them: an emoji is one, so is each Bangla letter or sign. */
export function captionLength(text: string): number {
  return Array.from(text).length
}

/** #hashtags in a caption, in any script (#ঈদ_অফার counts); "page#top" does not. */
export function hashtagCount(text: string): number {
  return text.match(/(?:^|[^\p{L}\p{M}\p{N}_&/#])#[\p{L}\p{M}\p{N}_]+/gu)?.length ?? 0
}

/** A photo chosen for a post. */
export type PickedPhoto = { id: string; url: string; kind: SocialPostMedia['kind']; name?: string }

/** The order the server posts them in: product photos first, then library images (each in picking order). */
export function postingOrder<T extends { kind: SocialPostMedia['kind'] }>(photos: readonly T[]): T[] {
  return [...photos.filter((p) => p.kind === 'product_image'), ...photos.filter((p) => p.kind === 'media')]
}

export type PostDraft = {
  productId: string | null
  photos: PickedPhoto[]
  caption: string
  /** Store path typed by the user ("" = the product's page, or no link without a product). */
  linkUrl: string
  campaignId: string | null
  targets: SocialTarget[]
  when: 'now' | 'schedule'
  /** datetime-local value in the organization's time zone. */
  scheduledAt: string
}

export type DraftField = 'photos' | 'caption' | 'link' | 'targets' | 'scheduled_at'
export type DraftProblems = Partial<Record<DraftField, string>>

/** What to do on submit: keep a draft, schedule it, or post it now. */
export type SubmitIntent = 'draft' | 'schedule' | 'now'

const YEAR_MS = 366 * 24 * 60 * 60 * 1000

/**
 * The server's rules, checked before sending. Drafts only need a caption and a target; posting
 * and scheduling add the Instagram rules (a photo, at most 30 hashtags) and a future time.
 */
export function draftProblems(
  draft: PostDraft,
  intent: SubmitIntent,
  context: { instagramLinked: boolean; timeZone?: string; now?: Date },
): DraftProblems {
  const problems: DraftProblems = {}
  const length = captionLength(draft.caption)
  const instagram = draft.targets.includes('instagram')
  const going = intent !== 'draft'

  if (draft.caption.trim() === '') problems.caption = 'Write a caption.'
  else if (length > CAPTION_MAX) problems.caption = `Keep the caption to ${CAPTION_MAX.toLocaleString('en-US')} characters (now ${length.toLocaleString('en-US')}).`
  else if (going && instagram && hashtagCount(draft.caption) > INSTAGRAM_MAX_HASHTAGS) {
    problems.caption = `Instagram allows at most ${INSTAGRAM_MAX_HASHTAGS} hashtags (now ${hashtagCount(draft.caption)}).`
  }

  if (draft.targets.length === 0) problems.targets = 'Choose Facebook, Instagram or both.'
  else if (going && instagram && !context.instagramLinked) problems.targets = 'No Instagram account is linked to the Facebook Page. Untick Instagram to post on Facebook only.'

  if (draft.photos.length > MAX_PHOTOS) problems.photos = `Choose at most ${MAX_PHOTOS} photos.`
  else if (going && instagram && draft.photos.length === 0) problems.photos = 'Instagram needs at least one photo.'

  const link = draft.linkUrl.trim()
  if (link !== '') {
    const problem = storePathProblem(link)
    if (problem) problems.link = problem
  }

  if (intent === 'schedule') {
    const at = fromZonedInput(draft.scheduledAt, context.timeZone)
    const now = (context.now ?? new Date()).getTime()
    if (!at) problems.scheduled_at = 'Pick the day and time to post.'
    else if (new Date(at).getTime() <= now) problems.scheduled_at = 'Pick a time in the future.'
    else if (new Date(at).getTime() > now + YEAR_MS) problems.scheduled_at = 'Pick a time within the next year.'
  }
  return problems
}

/** The API body for a draft: photos in posting order, trimmed texts, the time with its offset. */
export function draftToInput(draft: PostDraft, intent: SubmitIntent, timeZone: string | undefined): SocialPostInput {
  const ordered = postingOrder(draft.photos)
  return {
    caption: draft.caption.trim(),
    targets: SOCIAL_TARGETS.filter((t) => draft.targets.includes(t)),
    image_ids: ordered.filter((p) => p.kind === 'product_image').map((p) => p.id),
    media_ids: ordered.filter((p) => p.kind === 'media').map((p) => p.id),
    link_url: draft.linkUrl.trim() || null,
    product_id: draft.productId,
    campaign_id: draft.campaignId,
    scheduled_at: intent === 'schedule' ? fromZonedInput(draft.scheduledAt, timeZone) : null,
  }
}

/** A post as the composer edits it (null = a new post for the connected account). */
export function postToDraft(post: SocialPost | null, instagramLinked: boolean, timeZone: string | undefined): PostDraft {
  return {
    productId: post?.product?.id ?? null,
    photos: (post?.media ?? []).map((m) => ({ id: m.id, url: m.url, kind: m.kind })),
    caption: post?.caption ?? '',
    linkUrl: post?.link_url ?? '',
    campaignId: post?.campaign?.id ?? null,
    targets: post ? [...post.targets] : instagramLinked ? ['facebook', 'instagram'] : ['facebook'],
    when: post?.status === 'scheduled' ? 'schedule' : 'now',
    scheduledAt: toZonedInput(post?.scheduled_at, timeZone),
  }
}

/** Refusals of schedule / publish / retry (422 codes) in plain words. */
const POST_ERRORS: Record<string, string> = {
  SOCIAL_NOT_CONNECTED: 'Connect your Facebook Page first.',
  INSTAGRAM_NOT_CONNECTED: 'No Instagram account is linked to the Facebook Page. Untick Instagram, or link an Instagram business account to the Page on Facebook and connect again.',
  INSTAGRAM_IMAGE_REQUIRED: 'Instagram needs at least one photo.',
  INSTAGRAM_TOO_MANY_HASHTAGS: `Instagram allows at most ${INSTAGRAM_MAX_HASHTAGS} hashtags. Remove some and try again.`,
  MEDIA_NOT_PUBLIC:
    'Facebook and Instagram copy the photos from your store’s web address, and it is not public yet. Add your store’s domain (https://) under Online store → Settings & domains.',
  INSTAGRAM_JPEG_ONLY: 'Instagram only takes JPEG photos. Choose JPEG photos, or upload JPEG copies to the media library.',
  INVALID_STATUS_TRANSITION: 'This post changed in the meantime (it may be posting already). The list is refreshed — check it and try again.',
}

/** A failed request about a post, in plain words (known codes mapped, else the server's message). */
export function postErrorText(error: unknown): string {
  if (error instanceof ApiError) {
    // e.g. image_ids: "A photo of this post was deleted…" when publishing from the list.
    const field = error.code === 'VALIDATION_FAILED' ? Object.values(error.fieldErrors)[0]?.[0] : undefined
    return field ?? POST_ERRORS[error.code] ?? error.message
  }
  return error instanceof Error ? error.message : 'Something went wrong.'
}

/** Why one network did not take the post (results[].error.code). */
const RESULT_ERRORS: Record<string, string> = {
  TOKEN_EXPIRED: 'Facebook wants you to log in again. Reconnect Facebook, then retry.',
  PERMISSION_MISSING: 'Facebook did not give permission to post. Reconnect Facebook, allow every permission it asks for, then retry.',
  RATE_LIMITED: 'Facebook asked us to slow down. Wait a few minutes, then retry.',
  MEDIA_NOT_PUBLIC: 'The photos are not on a public https:// address, so they could not be fetched. Add your store’s domain, then retry.',
  MEDIA_REJECTED: 'A photo was refused (its size, shape or format). Try other photos.',
  SPAM_BLOCKED: 'Facebook blocked this post as possible spam. Change the text or the link, and retry later.',
  NOT_CONNECTED: 'The Page is no longer connected. Connect Facebook again, then retry.',
  NETWORK_ERROR: 'Facebook could not be reached. Retry in a moment.',
  GRAPH_ERROR: 'Facebook refused the post.',
  PUBLISH_INTERRUPTED: 'Posting was interrupted. Retry to finish it.',
  SANDBOX_FAILURE: 'Practice failure: the caption contains #fail-test. Nothing was posted.',
  MEDIA_MISSING: 'A photo of this post was deleted. Pick another photo and try again.',
}

/** Plain words for a network's failure, with the server's detail where the code alone says little. */
export function resultErrorText(error: SocialPostResult['error']): string {
  if (!error) return 'Not posted.'
  const mapped = RESULT_ERRORS[error.code]
  if (!mapped) return error.message || 'Not posted.'
  if (error.code === 'GRAPH_ERROR' && error.message && error.message !== mapped) return `${mapped} ${error.message}`
  return mapped
}

/** `?error=` codes of the Facebook connection (callback or connect). */
const CONNECT_ERRORS: Record<string, string> = {
  session_expired: 'Your session ended while connecting. Sign in again if asked, then press Connect again.',
  state_invalid: 'The connection link was too old or used twice. Press Connect again.',
  access_denied: 'The Facebook login was cancelled, so nothing was connected.',
  app_not_configured: 'Enter your Meta app ID and app secret under “Meta app” below, then connect again.',
  token_exchange_failed: 'Facebook did not accept the app ID or secret. Check them under “Meta app” below, then connect again.',
  no_pages: 'This Facebook account does not manage any Page. Create a Page on Facebook (or ask its admin to add you), then connect again.',
  graph_error: 'Facebook did not answer as expected. Wait a moment, then connect again.',
}

export function connectErrorText(code: string): string {
  return CONNECT_ERRORS[code] ?? 'Facebook could not be connected. Please try again.'
}

/** Why the suggestions are ready-made ones (source "template"). */
export function captionSourceNote(source: 'ai' | 'template', reason: CaptionFallbackReason | null): string {
  if (source === 'ai') return 'Written by AI from the product’s details. Read and edit before posting.'
  switch (reason) {
    case 'disabled':
      return 'AI is off for your shop, so these are ready-made suggestions with the product’s name and price.'
    case 'budget_exceeded':
      return 'This month’s AI budget is used up, so these are ready-made suggestions with the product’s name and price.'
    case 'unavailable':
    case 'invalid_output':
      return 'The AI could not help just now, so these are ready-made suggestions with the product’s name and price.'
    default:
      return 'Ready-made suggestions with the product’s name and price.'
  }
}

/** The toast after a post settles (null while it is still posting or not posted). */
export function outcomeMessage(post: SocialPost): { kind: 'success' | 'warning' | 'error'; text: string } | null {
  // `sandbox` is only set on published targets.
  const practice = post.results.some((r) => r.status === 'published' && r.sandbox) ? ' (practice mode: nothing was really posted)' : ''
  const failed = post.results.filter((r) => r.status === 'failed')
  const posted = post.results.filter((r) => r.status === 'published').map((r) => r.target)
  const firstError = failed[0] ? resultErrorText(failed[0].error) : 'Not posted.'

  if (post.status === 'published') return { kind: 'success', text: `Posted to ${targetList(posted.length ? posted : post.targets)}${practice}.` }
  if (post.status === 'partially_published') {
    return { kind: 'warning', text: `Posted to ${targetList(posted)}${practice}. ${targetList(failed.map((r) => r.target))} failed: ${firstError}` }
  }
  if (post.status === 'failed') return { kind: 'error', text: `The post failed: ${firstError}` }
  return null
}

/** The visible status of one network's result (a pending one while the post is scheduled says "Waiting"). */
export function resultLabel(result: SocialPostResult, postStatus: SocialPostStatus): string {
  switch (result.status) {
    case 'published':
      return 'Posted'
    case 'failed':
      return 'Not posted'
    case 'publishing':
      return 'Posting…'
    default:
      return postStatus === 'scheduled' ? 'Waiting for its time' : postStatus === 'publishing' ? 'Posting…' : 'Not posted yet'
  }
}
