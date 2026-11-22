import { useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { fetchDocument } from '../api'
import { useEditor, useEditorStoreApi } from '../store'
import { WizardDialog } from '../wizard/wizard-dialog'
import type { WizardPageType, WizardResult } from '../wizard/wizard-api'
import { pageTypeOf } from './next-sections'
import { NextStrip, type NextStripPlace } from './next-strip'
import type { NextSections } from './use-next-sections'

/*
 * B21: the canvas's "What next?" strip with, on an empty home or campaign page, "Build it for me"
 * (the wizard). Building into the open home draft reloads it here; anything else opens the new
 * page. The editor passes this as the canvas's `nextStrip`.
 */

function wizardTypeFor(doc: { key: string; title: string }): WizardPageType | null {
  if (doc.key === 'home') return 'home'
  if (!doc.key.startsWith('landing:')) return null
  const type = pageTypeOf(doc)
  return type === 'launch' ? 'product_launch' : type === 'sale' || type === 'festival' || type === 'about' || type === 'contact' ? type : 'sale'
}

export function NextStripHost({ place, next, onMore }: { place: NextStripPlace; next: NextSections; onMore: () => void }) {
  const store = useEditorStoreApi()
  const navigate = useNavigate()
  const kind = useEditor((s) => s.document.kind)
  const key = useEditor((s) => s.document.key)
  const title = useEditor((s) => s.document.title)
  const documentId = useEditor((s) => s.document.id)
  const [open, setOpen] = useState(false)
  const wizardType = kind === 'page' ? wizardTypeFor({ key, title }) : null
  const empty = place.rect === null

  const built = async (result: WizardResult) => {
    if (result.document.id !== documentId) return void navigate(`/storefront/builder/${result.document.id}`)
    try {
      store.getState().load(await fetchDocument(documentId))
    } catch {
      toast.error('The new page couldn’t be loaded. Open it again from the Page builder screen.')
    }
  }

  if (!next.available && !(empty && wizardType)) return null
  return (
    <>
      <NextStrip
        place={place}
        suggestions={next.atEnd}
        pendingId={next.pendingId}
        onInsert={(suggestion) => next.insert(suggestion, 'end')}
        onMore={onMore}
        onBuild={empty && wizardType ? () => setOpen(true) : null}
      />
      {wizardType && <WizardDialog open={open} onOpenChange={setOpen} initialType={wizardType} onBuilt={(result) => void built(result)} />}
    </>
  )
}
