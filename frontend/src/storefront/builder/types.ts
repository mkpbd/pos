/*
 * Visual store builder, document format v1 (STORE_BUILDER_PLAN §4, B1 contract §1) and the render
 * payload of GET /api/v1/store/builder/pages/{home|slug} (contract §2). The backend's
 * BuilderDocumentSchema::normalize is the source of truth; ./validate.ts mirrors its value rules.
 */

import type { MediaRef, StoreSection, ThemeColors } from '../types'

export type Breakpoint = 'base' | 'tablet' | 'mobile'
export type Device = 'desktop' | 'tablet' | 'mobile'

/* ----------------------------------------------------------------------------------------------
 * Style values (sparse overrides; normalize drops unknown/invalid keys and never fills defaults)
 * -------------------------------------------------------------------------------------------- */

export type ThemeColorRole = keyof ThemeColors
/** `#rrggbb`, `#rrggbbaa` (lower case) or `theme:<role>`. */
export type Color = string
/** `^-?\d{1,4}(\.\d{1,2})?(px|rem|em|%|vh|vw)$`, bounded; `auto` for margins only. */
export type Length = string

export type GradientStop = { color: Color; position: number }
export type Gradient = { type: 'linear' | 'radial'; angle?: number; shape?: 'circle' | 'ellipse'; stops: GradientStop[] }

export type BackgroundPosition = 'center' | 'top' | 'bottom' | 'left' | 'right' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
export type Background = {
  type: 'none' | 'color' | 'gradient' | 'image'
  color?: Color
  gradient?: Gradient
  image?: { media_id: string; position: BackgroundPosition; size: 'cover' | 'contain' | 'auto'; repeat: boolean }
  overlay?: Color | Gradient
}

export type Typography = {
  font?: 'theme:heading' | 'theme:body'
  size?: Length
  weight?: number
  line_height?: number
  letter_spacing?: Length
  align?: 'left' | 'center' | 'right' | 'justify'
  transform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize'
}

export type Sides = { top?: Length; right?: Length; bottom?: Length; left?: Length }

export type Shadow = { x: number; y: number; blur: number; spread: number; color: Color; inset: boolean }

export type Style = {
  background?: Background
  color?: Color
  typography?: Typography
  spacing?: { margin?: Sides; padding?: Sides }
  size?: { width?: Length; height?: Length; min_height?: Length; max_width?: Length }
  layout?: {
    gap?: Length
    row_gap?: Length
    align?: 'start' | 'center' | 'end' | 'stretch'
    justify?: 'start' | 'center' | 'end' | 'between' | 'around'
    wrap?: boolean
  }
  border?: {
    width?: Length
    style?: 'none' | 'solid' | 'dashed' | 'dotted'
    color?: Color
    radius?: { tl?: Length; tr?: Length; br?: Length; bl?: Length }
  }
  effects?: {
    shadow?: Shadow[]
    text_shadow?: Shadow[]
    opacity?: number
    hover?: { color?: Color; background_color?: Color; shadow?: Shadow[]; transform?: 'none' | 'lift' | 'grow' }
  }
}

export type ResponsiveStyle = Partial<Record<Breakpoint, Style>>

/* ----------------------------------------------------------------------------------------------
 * Nodes
 * -------------------------------------------------------------------------------------------- */

export type Visibility = Record<Device, boolean>
export type Schedule = null | { starts_at: string | null; ends_at: string | null }
export type Link = null | { url: string }

/** Common to sections and elements. */
type NodeCommon = {
  id: string
  style: ResponsiveStyle
  visibility: Visibility
  hidden: boolean
  schedule: Schedule
  translations: Record<string, Record<string, string>>
}

export type Column<E = Element> = {
  id: string
  type: 'column'
  /** Percent of the row (5–100, ≤ 2 decimals); tablet and mobile fall back to the wider breakpoint. */
  width: { base: number; tablet?: number; mobile?: number }
  style: ResponsiveStyle
  elements: E[]
}

export type WrappedSectionType = StoreSection['type']

export type WrappedSectionProps = {
  title: string | null
  subtitle: string | null
  config: Record<string, unknown>
  items: { item_type: string; item_id: string }[]
}

type ElementOf<T extends string, P> = NodeCommon & { type: T; props: P }

export type HeadingElement = ElementOf<'heading', { text: string; level: 1 | 2 | 3 | 4 | 5 | 6; link: Link }>
export type TextElement = ElementOf<'text', { html: string }>
export type ImageElement = ElementOf<
  'image',
  { media_id: string | null; alt: string; link: Link; aspect: 'auto' | '1:1' | '4:3' | '3:2' | '16:9' | '3:4'; fit: 'cover' | 'contain' }
>
export type ButtonElement = ElementOf<
  'button',
  { label: string; link: { url: string }; variant: 'primary' | 'accent' | 'outline' | 'link'; size: 'sm' | 'md' | 'lg'; full_width: boolean }
>
export type SpacerElement = ElementOf<'spacer', Record<string, never>>
export type DividerElement = ElementOf<
  'divider',
  { line: 'solid' | 'dashed' | 'dotted'; thickness: number; width: number; color: Color; align: 'left' | 'center' | 'right' }
>
export type InnerRowElement = ElementOf<'inner_row', Record<string, never>> & { columns: Column<Exclude<Element, InnerRowElement>>[] }
export type WrappedElement = NodeCommon & { type: WrappedSectionType; props: WrappedSectionProps }

export type Element = HeadingElement | TextElement | ImageElement | ButtonElement | SpacerElement | DividerElement | InnerRowElement | WrappedElement

export type ElementType = Element['type']

export type Section = NodeCommon & {
  type: 'section'
  props: { layout: 'boxed' | 'full' | 'full-bleed'; anchor: string | null }
  columns: Column[]
}

/** A stored document (draft or published version content). */
export type BuilderDocument = { schema_version: 1; sections: Section[] }

/* ----------------------------------------------------------------------------------------------
 * Render payload
 * -------------------------------------------------------------------------------------------- */

/** Draft preview only: why a node is not shown to visitors. */
export type NodeState = 'hidden' | 'scheduled' | 'expired' | 'empty'

/** A document node as rendered: translations resolved and removed; `state` only in draft previews. */
type Rendered<N> = N extends unknown ? Omit<N, 'translations' | 'hidden' | 'schedule'> & { hidden?: boolean; schedule?: Schedule; state?: NodeState } : never

export type RenderColumn = Omit<Column, 'elements'> & { elements: RenderElement[] }
export type RenderInnerRow = Rendered<Omit<InnerRowElement, 'columns'>> & { columns: RenderColumn[] }
export type RenderElement = Rendered<Exclude<Element, InnerRowElement>> | RenderInnerRow
export type RenderSection = Rendered<Omit<Section, 'columns'>> & { columns: RenderColumn[] }

export type BuilderMedia = Omit<MediaRef, 'id'>

export type BuilderPage = {
  document: { id: string; key: string; title: string; version: number | null; source: 'published' | 'draft' }
  sections: RenderSection[]
  media: Record<string, BuilderMedia>
  /** For each wrapped-section element: the object /store/homepage returns for that section (id = element id). */
  data: Record<string, StoreSection>
}
