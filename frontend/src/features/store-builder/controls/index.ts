/*
 * Shared design controls (B3): used by the store builder's Style tab and by the global styles
 * panel (features/storefront/theme). Every control is value in / value out; the Style tab adds
 * the per-device indicator through each control's `status` slot (`statusFor` on grouped ones).
 */
export { ColorControl, ColorEditor, ContrastHint, type ColorControlProps } from './color-control'
export { PaletteSwatches, Swatch, SwatchButton } from './palette-swatches'
export { ControlLabel, HelpTip } from './control-label'
export { Segmented, SelectControl, SliderControl, type Option } from './primitives'
export { LengthControl, type LengthControlProps } from './length-control'
export { GradientControl, type GradientControlProps } from './gradient-control'
export { ShadowControl, type ShadowControlProps } from './shadow-control'
export { SpacingBox, type SpacingBoxName, type SpacingValue } from './spacing-box'
export { TypographyControl, type TypographyKey } from './typography-control'
export { BorderControl, type BorderKey } from './border-control'
export { BackgroundControl } from './background-control'
export { HoverControl, type Hover, type HoverKey } from './hover-control'
export * from './color-utils'
export * from './model'
