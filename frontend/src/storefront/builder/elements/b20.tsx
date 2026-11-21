import { lazy, Suspense, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { animatedIconColor, iconBoxStyle, illustrationBoxStyle } from '../graphics/icon-box'
import { isAnimatedIconName, isIllustrationName } from '../graphics/names'
import { DraftPlaceholder } from '../preview-mark'
import type { RenderElement } from '../types'
import { B20_DEFAULTS, B20_ENUMS, B20_LIMITS, B20_TEXT_LIMITS, boundedInt, oneOf } from '../validate'
import type { B20Type } from './b20-types'
import { JUSTIFY, str, type El } from './shared'

/*
 * Renderers of the B20 elements (contract §1): an animated icon and an animated illustration. Only
 * these small shells are in the storefront entry: they reserve the drawing's box (no layout shift)
 * and carry the accessible name — `role="img"` + the label / alt, or `aria-hidden` when empty
 * (decorative). The drawings and their motion load as lazy chunks (../graphics/animated-icon,
 * ../graphics/illustration and one chunk per illustration scene).
 */

const AnimatedIconArt = lazy(() => import('../graphics/animated-icon'))
const IllustrationArt = lazy(() => import('../graphics/illustration'))

/** Accessible name or decorative, on the element's root. */
function a11y(name: string) {
  return name ? ({ role: 'img', 'aria-label': name } as const) : ({ 'aria-hidden': true } as const)
}

export function AnimatedIconElement({ element }: { element: El<'animated_icon'> }) {
  const p = element.props ?? {}
  if (!isAnimatedIconName(p.name)) return <DraftPlaceholder element={element} />
  const d = B20_DEFAULTS.animatedIcon
  const size = boundedInt(p.size, B20_LIMITS.iconSize.min, B20_LIMITS.iconSize.max, d.size)
  const stroke = boundedInt(p.stroke, B20_LIMITS.iconStroke.min, B20_LIMITS.iconStroke.max, d.stroke)
  const animation = oneOf(p.animation, B20_ENUMS.animatedIconAnimation) ?? d.animation
  const trigger = oneOf(p.trigger, B20_ENUMS.animatedIconTrigger) ?? d.trigger
  const background = oneOf(p.background, B20_ENUMS.animatedIconBackground) ?? d.background
  const color = animatedIconColor(p.color_role, p.color)
  const label = str(p.label).slice(0, B20_TEXT_LIMITS.animated_icon.label).trim()

  return (
    <span data-b={element.id} className="b-animated-icon inline-flex leading-none" data-testid="builder-animated-icon" data-name={p.name} {...a11y(label)}>
      <Suspense fallback={<span className="inline-block" style={iconBoxStyle(size, background, color)} />}>
        <AnimatedIconArt name={p.name} animation={animation} trigger={trigger} size={size} stroke={stroke} color={color} background={background} />
      </Suspense>
    </span>
  )
}

export function IllustrationElement({ element }: { element: El<'illustration'> }) {
  const p = element.props ?? {}
  if (!isIllustrationName(p.name)) return <DraftPlaceholder element={element} />
  const d = B20_DEFAULTS.illustration
  const play = oneOf(p.play, B20_ENUMS.illustrationPlay) ?? d.play
  const size = oneOf(p.size, B20_ENUMS.illustrationSize) ?? d.size
  const align = oneOf(p.align, B20_ENUMS.align) ?? d.align
  const palette = oneOf(p.palette, B20_ENUMS.illustrationPalette) ?? d.palette
  const alt = str(p.alt).slice(0, B20_TEXT_LIMITS.illustration.alt).trim()

  return (
    <div data-b={element.id} className={cn('b-illustration flex w-full', JUSTIFY[align])} data-testid="builder-illustration" data-name={p.name}>
      <div className="block" style={illustrationBoxStyle(size)} {...a11y(alt)}>
        <Suspense fallback={null}>
          <IllustrationArt name={p.name} palette={palette} play={play} />
        </Suspense>
      </div>
    </div>
  )
}

const RENDERERS: { [T in B20Type]: (props: { element: El<T> }) => ReactNode } = {
  animated_icon: AnimatedIconElement,
  illustration: IllustrationElement,
}

/** One B20 element (the caller has checked its visibility). */
export function B20ElementContent({ element }: { element: RenderElement }) {
  const Render = RENDERERS[element.type as B20Type] as ((props: { element: RenderElement }) => ReactNode) | undefined
  return Render ? <Render element={element} /> : null
}
