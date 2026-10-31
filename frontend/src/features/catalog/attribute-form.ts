import { z } from 'zod'
import { ATTRIBUTE_DISPLAYS, type Attribute, type AttributeInput } from '@/features/catalog/api'
import { SLUG_PATTERN } from '@/features/content/slug'

export const MAX_ATTRIBUTE_VALUES = 100
export const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/

export const attributeFormSchema = z
  .object({
    name: z.string().trim().min(1, 'Required.').max(60, 'At most 60 characters.'),
    slug: z.union([z.literal(''), z.string().max(80, 'At most 80 characters.').regex(SLUG_PATTERN, 'Lower-case letters, digits and single hyphens, e.g. size.')]),
    display: z.enum(ATTRIBUTE_DISPLAYS),
    is_filterable: z.boolean(),
    values: z
      .array(z.object({ id: z.string().optional(), value: z.string().trim().min(1, 'Enter a value.').max(60, 'At most 60 characters.'), swatch_hex: z.string() }))
      .max(MAX_ATTRIBUTE_VALUES, `At most ${MAX_ATTRIBUTE_VALUES} values.`),
  })
  .superRefine((form, ctx) => {
    const seen = new Set<string>()
    form.values.forEach((v, i) => {
      const key = v.value.trim().toLowerCase()
      if (key && seen.has(key)) ctx.addIssue({ code: 'custom', path: ['values', i, 'value'], message: 'Listed twice.' })
      seen.add(key)
      if (form.display === 'swatch' && !HEX_PATTERN.test(v.swatch_hex)) ctx.addIssue({ code: 'custom', path: ['values', i, 'swatch_hex'], message: 'Pick a colour.' })
    })
  })

export type AttributeFormValues = z.infer<typeof attributeFormSchema>

export function toAttributeFormValues(attribute: Attribute | null): AttributeFormValues {
  return {
    name: attribute?.name ?? '',
    slug: attribute?.slug ?? '',
    display: attribute?.display ?? 'button',
    is_filterable: attribute?.is_filterable ?? true,
    values: [...(attribute?.values ?? [])].sort((a, b) => a.sort_order - b.sort_order).map((v) => ({ id: v.id, value: v.value, swatch_hex: v.swatch_hex ?? '' })),
  }
}

/** Swatch colours are only sent for swatch attributes; values keep their order. */
export function toAttributeInput(form: AttributeFormValues): AttributeInput {
  return {
    name: form.name.trim(),
    ...(form.slug ? { slug: form.slug } : {}),
    display: form.display,
    is_filterable: form.is_filterable,
    values: form.values.map((v) => ({
      ...(v.id ? { id: v.id } : {}),
      value: v.value.trim(),
      swatch_hex: form.display === 'swatch' ? v.swatch_hex.toLowerCase() : null,
    })),
  }
}
