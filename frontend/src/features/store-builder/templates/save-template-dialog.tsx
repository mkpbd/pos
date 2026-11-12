import { useState } from 'react'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ApiError } from '@/lib/api/client'
import type { DocumentContext, Section } from '@/storefront/builder/types'
import { useSaveTemplateMutation } from './api'

/*
 * Save as template (B5): a section of this document becomes one of the organization's own
 * templates (Templates → Mine). Its images and banners stay the store's own, so it is only offered
 * to this store.
 */

export const TEMPLATE_NAME_MAX = 120
export const TEMPLATE_DESCRIPTION_MAX = 300

function serverMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return error instanceof Error ? error.message : 'The template couldn’t be saved.'
  if (error.code === 'TEMPLATE_LIMIT_REACHED') return 'You have 100 saved templates, the most a store can keep. Delete one under Templates → Mine first.'
  if (error.code === 'TEMPLATE_TOO_LARGE') return 'This section is too large to save as a template (256 KB at most). Save a smaller part of it.'
  const field = Object.values(error.fieldErrors)[0]?.[0]
  return field ?? error.message
}

export function SaveTemplateDialog({ section, context, onClose }: { section: Section | null; context: DocumentContext; onClose: () => void }) {
  const save = useSaveTemplateMutation()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const nameProblem = name.trim() ? null : 'Enter a name.'

  const close = () => {
    setName('')
    setDescription('')
    setSubmitted(false)
    save.reset()
    onClose()
  }

  return (
    <Dialog open={section !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save as template</DialogTitle>
          <DialogDescription>Keep this section to use again on other pages. You’ll find it in the Templates tab under Mine.</DialogDescription>
        </DialogHeader>
        <form
          id="save-template"
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            setSubmitted(true)
            if (nameProblem || !section) return
            const trimmed = name.trim()
            save.mutate(
              { name: trimmed, description: description.trim() || null, scope: 'section', context, section },
              {
                onSuccess: () => {
                  toast.success(`Saved “${trimmed}” to your templates.`)
                  close()
                },
              },
            )
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="template-name">Name</Label>
            <Input id="template-name" value={name} maxLength={TEMPLATE_NAME_MAX} onChange={(e) => setName(e.target.value)} aria-invalid={submitted && !!nameProblem} placeholder="Eid offer banner" autoFocus />
            {submitted && nameProblem && <p className="text-sm text-destructive">{nameProblem}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="template-description">Description (optional)</Label>
            <Textarea id="template-description" value={description} maxLength={TEMPLATE_DESCRIPTION_MAX} rows={2} onChange={(e) => setDescription(e.target.value)} placeholder="What it is for, e.g. the banner for seasonal offers" />
          </div>
          {save.error && (
            <p role="alert" className="text-sm text-destructive">
              {serverMessage(save.error)}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form="save-template" disabled={save.isPending}>
            {save.isPending && <Loader2Icon className="animate-spin" aria-hidden />}
            Save template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
