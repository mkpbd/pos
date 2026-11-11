import { cloneSample } from '@/storefront/builder/test-payload'
import type { BuilderContent } from '@/storefront/builder/types'
import type { DocumentDetail } from './api'

/** A home page document (tests). */
export function detail(content: BuilderContent = cloneSample(), revision = 3): DocumentDetail {
  return {
    id: 'doc-1', kind: 'page', key: 'home', title: 'Home', schema_version: 1, draft_revision: revision, has_unpublished_changes: true,
    draft_updated_at: null, published: null, path: '/', preview_url: 'https://shop.test/?preview=draft', content,
  }
}
