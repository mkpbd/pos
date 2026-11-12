/** "12/120": a text's length against its limit. */
export const counter = (text: string | null | undefined, max: number) => `${(text ?? '').length}/${max}`

/** `shield-check` → "Shield check". */
export const iconLabel = (name: string) => name.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase())
