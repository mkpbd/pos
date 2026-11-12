import type { ReactNode } from 'react'
import { AlignCenterIcon, AlignJustifyIcon, AlignLeftIcon, AlignRightIcon } from 'lucide-react'
import type { Typography } from '@/storefront/builder/types'
import { LengthControl } from './length-control'
import { FONT_WEIGHTS } from './model'
import { Segmented, SelectControl, SliderControl } from './primitives'

export type TypographyKey = keyof Typography

const ALL: readonly TypographyKey[] = ['font', 'size', 'weight', 'line_height', 'letter_spacing', 'align', 'transform']

/**
 * Text style: theme font (headings / body), size, weight, line height, letter spacing, alignment
 * and capitals. `value` holds what applies now; each change reports one key (undefined = unset).
 */
export function TypographyControl({ value, onChange, statusFor, fields = ALL }: {
  value: Typography
  onChange: <K extends TypographyKey>(key: K, value: Typography[K] | undefined) => void
  statusFor?: (key: TypographyKey) => ReactNode
  fields?: readonly TypographyKey[]
}) {
  const show = (key: TypographyKey) => fields.includes(key)
  return (
    <div className="flex flex-col gap-3" data-control="typography">
      {show('font') && (
        <SelectControl
          label="Font"
          value={value.font}
          placeholder="Default for this element"
          tooltip="Uses one of your theme’s two fonts, so it changes with the theme."
          options={[{ value: 'theme:heading', label: 'Heading font (theme)' }, { value: 'theme:body', label: 'Body font (theme)' }]}
          onChange={(font) => onChange('font', font)}
          status={statusFor?.('font')}
        />
      )}
      {show('size') && (
        <LengthControl
          label="Text size"
          value={value.size}
          units={['px', 'rem', 'em']}
          slider={{ min: 10, max: 96, step: 1 }}
          placeholder="Default"
          onChange={(size) => onChange('size', size)}
          status={statusFor?.('size')}
        />
      )}
      {show('weight') && (
        <SelectControl
          label="Weight"
          value={value.weight === undefined ? undefined : (String(value.weight) as (typeof FONT_WEIGHTS)[number]['value'])}
          placeholder="Default"
          tooltip="How thick the letters are. Not every font has every weight."
          options={FONT_WEIGHTS}
          onChange={(weight) => onChange('weight', Number(weight))}
          status={statusFor?.('weight')}
        />
      )}
      {show('line_height') && (
        <SliderControl
          label="Line height"
          value={value.line_height}
          min={0.8}
          max={3}
          step={0.05}
          placeholder={1.5}
          tooltip="Space between lines, as a multiple of the text size."
          format={(n) => `${Math.round(n * 100) / 100}×`}
          onChange={(n) => onChange('line_height', Math.round(n * 100) / 100)}
          status={statusFor?.('line_height')}
        />
      )}
      {show('letter_spacing') && (
        <LengthControl
          label="Letter spacing"
          value={value.letter_spacing}
          units={['em', 'px']}
          allowNegative
          placeholder="Normal"
          tooltip="Space between letters. Small values like 0.05 em make capitals easier to read."
          onChange={(spacing) => onChange('letter_spacing', spacing)}
          status={statusFor?.('letter_spacing')}
        />
      )}
      {show('align') && (
        <Segmented
          label="Alignment"
          value={value.align}
          options={[
            { value: 'left', label: 'Align left', icon: <AlignLeftIcon aria-hidden /> },
            { value: 'center', label: 'Align centre', icon: <AlignCenterIcon aria-hidden /> },
            { value: 'right', label: 'Align right', icon: <AlignRightIcon aria-hidden /> },
            { value: 'justify', label: 'Justify', icon: <AlignJustifyIcon aria-hidden /> },
          ]}
          onChange={(align) => onChange('align', align)}
          status={statusFor?.('align')}
        />
      )}
      {show('transform') && (
        <Segmented
          label="Capitals"
          value={value.transform}
          options={[
            { value: 'none', label: 'As typed', title: 'As typed' },
            { value: 'uppercase', label: 'AA', title: 'ALL CAPITALS' },
            { value: 'lowercase', label: 'aa', title: 'all lower case' },
            { value: 'capitalize', label: 'Aa', title: 'Each Word Capitalised' },
          ]}
          onChange={(transform) => onChange('transform', transform)}
          status={statusFor?.('transform')}
        />
      )}
    </div>
  )
}
