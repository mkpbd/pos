import { useEffect, useMemo, useRef, useState } from 'react'
import { PlayIcon } from 'lucide-react'
import { MenuLink } from '../../components/menu-link'
import { RichText } from '../../components/rich-text'
import { useLocale } from '../../i18n/locale'
import { sanitizeHtml } from '../canvas/sanitize'
import { colorCss } from '../compile-styles'
import { BuilderIcon, isIconName } from '../icons'
import { DraftPlaceholder } from '../preview-mark'
import { B4_ENUMS, B4_LIMITS, boundedInt, oneOf, safeLink, videoEmbedUrl } from '../validate'
import { str, type El } from './shared'

const VIDEO_RATIOS = { '16:9': '16 / 9', '4:3': '4 / 3', '1:1': '1 / 1', '9:16': '9 / 16' } as const
const PROVIDER_NAMES = { youtube: 'YouTube', vimeo: 'Vimeo' } as const

/**
 * A YouTube or Vimeo video behind a poster: nothing is loaded from the provider (no cookies, no
 * thumbnail request) until the visitor presses play; then the privacy-enhanced player
 * (youtube-nocookie / Vimeo `dnt=1`) loads lazily in place and takes the focus.
 */
export function VideoElement({ element }: { element: El<'video'> }) {
  const { t } = useLocale()
  const [playing, setPlaying] = useState(false)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const p = element.props ?? {}
  const provider = oneOf(p.provider, B4_ENUMS.videoProvider)
  const src = provider ? videoEmbedUrl(provider, p.video_id, { autoplay: p.autoplay === true, start: typeof p.start === 'number' ? p.start : 0 }) : null
  const ratio = VIDEO_RATIOS[oneOf(p.aspect, B4_ENUMS.videoAspect) ?? '16:9']
  const title = str(p.title)

  useEffect(() => {
    if (playing) frameRef.current?.focus()
  }, [playing])

  if (!src || !provider) return <DraftPlaceholder element={element} />

  return (
    <div data-b={element.id} className="b-video relative w-full overflow-hidden rounded-sf-card bg-neutral-900" style={{ aspectRatio: ratio }} data-testid="builder-video">
      {playing ? (
        <iframe
          ref={frameRef}
          src={src}
          title={title || PROVIDER_NAMES[provider]}
          loading="lazy"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          className="absolute inset-0 size-full border-0"
        />
      ) : (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          aria-label={t('content.builder.video.play', { title: title || PROVIDER_NAMES[provider] })}
          className="group absolute inset-0 flex flex-col items-center justify-center gap-4 bg-linear-to-br from-neutral-800 to-neutral-950 p-6 text-center text-white focus-visible:outline-4 focus-visible:-outline-offset-4 focus-visible:outline-sf-accent"
        >
          <span aria-hidden className="grid size-16 place-items-center rounded-full bg-white/90 text-neutral-900 shadow-lg transition group-hover:scale-105 group-hover:bg-white">
            <PlayIcon className="ml-1 size-7 fill-current" />
          </span>
          {title && <span aria-hidden className="line-clamp-2 max-w-xl text-lg font-semibold">{title}</span>}
          <span aria-hidden className="text-xs text-white/70">{t('content.builder.video.source', { provider: PROVIDER_NAMES[provider] })}</span>
        </button>
      )}
    </div>
  )
}

/** An icon of the store set; with a label it is announced (and names its link), without one it is decorative. */
export function IconElement({ element }: { element: El<'icon'> }) {
  const p = element.props ?? {}
  if (!isIconName(p.name)) return <DraftPlaceholder element={element} />
  const size = boundedInt(p.size, B4_LIMITS.iconSize.min, B4_LIMITS.iconSize.max, 32)
  const color = colorCss(p.color)
  const label = str(p.label).trim()
  const url = safeLink(p.link)
  const icon = <BuilderIcon name={p.name} size={size} aria-hidden={label ? undefined : true} role={label && !url ? 'img' : undefined} aria-label={label && !url ? label : undefined} />

  return (
    <span data-b={element.id} className="b-icon inline-flex leading-none" style={color ? { color } : undefined}>
      {url ? (
        <MenuLink url={url} aria-label={label || p.name} className="inline-flex transition-opacity hover:opacity-80">
          {/* The link carries the name; the drawing itself stays silent. */}
          <BuilderIcon name={p.name} size={size} />
        </MenuLink>
      ) : (
        icon
      )}
    </span>
  )
}

/**
 * Custom HTML (server-sanitized; cleaned again here with the canvas sanitizer: no scripts, styles,
 * embeds, forms or event handlers). Drawn in the rich-text container, never executed.
 */
export function CustomHtmlElement({ element }: { element: El<'custom_html'> }) {
  const raw = str(element.props?.html).slice(0, B4_LIMITS.customHtml)
  const html = useMemo(() => sanitizeHtml(raw), [raw])
  if (!html.trim()) return <DraftPlaceholder element={element} />
  return <RichText data-b={element.id} html={html} className="b-custom-html" />
}
