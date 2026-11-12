import { createContext } from 'react'
import type { FaqGroup } from '../../types'

/** The CMS page's own FAQ (`/store/pages/{slug}` `faq`), used when an FAQ list has no `data[id]`. */
export const FaqFallbackCtx = createContext<FaqGroup[] | null>(null)
