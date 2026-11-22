import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import { toast } from 'sonner'
import { MAX_DROP_FILES, type FileDropTarget } from '@/storefront/builder/canvas/protocol'
import type { BuilderMedia, DocumentContext } from '@/storefront/builder/types'
import type { NodeUpload } from './canvas-frame'
import { noteBlocked } from './collab/use-presence'
import { altFromFileName, applyDroppedPictures, type DroppedPicture } from './file-drop'
import { BREAKPOINT } from './inspector/style-model'
import type { ElementsMetadata } from './inspector/types'
import { pictureFileProblem, uploadErrorMessage, uploadPicture } from './media-upload'
import type { EditorStore } from './store'

/*
 * B21: picture files dropped on the canvas (`drop-files`). Each usable file goes to the media
 * library (POST /media, one after the other, progress drawn on the target), a file that can't be
 * used or fails gets its own plain message, and then the page changes once — one undo step — with
 * every picture that arrived. A description is suggested from each file name.
 */

type Options = {
  store: EditorStore
  registry: ElementsMetadata
  context?: DocumentContext
  setUploads: Dispatch<SetStateAction<Record<string, NodeUpload>>>
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function useFileDrop({ store, registry, context, setUploads }: Options) {
  // Uploads still running when the editor closes are stopped.
  const running = useRef(new Set<AbortController>())
  useEffect(() => {
    const controllers = running.current
    return () => {
      for (const controller of controllers) controller.abort()
    }
  }, [])

  return useCallback(
    async (target: FileDropTarget, files: readonly File[]) => {
      if (store.getState().readOnly) return void noteBlocked(store)
      if (files.length > MAX_DROP_FILES) toast.info(`Up to ${MAX_DROP_FILES} pictures at a time: the first ${MAX_DROP_FILES} are added.`)
      const usable: File[] = []
      for (const file of files.slice(0, MAX_DROP_FILES)) {
        const problem = pictureFileProblem(file)
        if (problem) toast.error(problem)
        else usable.push(file)
      }
      if (usable.length === 0) return
      // A background takes one picture.
      const queue = target.kind === 'background' ? usable.slice(0, 1) : usable
      if (usable.length > queue.length) toast.info('A background takes one picture: the first one is used.')

      const key = target.node_id
      const total = queue.length
      const name = (file: File, index: number) => (total > 1 ? `${file.name} (${index + 1} of ${total})` : file.name)
      const controller = new AbortController()
      running.current.add(controller)
      const pictures: DroppedPicture[] = []
      const media: Record<string, BuilderMedia> = {}
      setUploads((u) => ({ ...u, [key]: { progress: null, name: name(queue[0]!, 0) } }))
      try {
        for (const [index, file] of queue.entries()) {
          const alt = altFromFileName(file.name)
          setUploads((u) => ({ ...u, [key]: { progress: index / total, name: name(file, index) } }))
          try {
            const item = await uploadPicture(file, {
              signal: controller.signal,
              ...(alt ? { alt } : {}),
              onProgress: (fraction) => setUploads((u) => (u[key] ? { ...u, [key]: { progress: (index + fraction) / total, name: name(file, index) } } : u)),
            })
            pictures.push({ mediaId: item.id, alt })
            media[item.id] = { url: item.url, srcset: item.srcset, width: item.width, height: item.height, alt: item.alt, ...(item.focal !== undefined ? { focal: item.focal } : {}) }
          } catch (error) {
            if (controller.signal.aborted) return
            toast.error(uploadErrorMessage(error, file.name))
          }
        }
      } finally {
        running.current.delete(controller)
        setUploads((u) => {
          if (!u[key]) return u
          const next = { ...u }
          delete next[key]
          return next
        })
      }
      if (pictures.length === 0) return

      const state = store.getState()
      if (state.readOnly) return void toast.info('The pictures are in your media library. Someone else is editing this page now, so it didn’t change.')
      const outcome = applyDroppedPictures(state.content, target, pictures, { breakpoint: BREAKPOINT[state.device], registry, context })
      if (outcome.placed === 0 || !state.apply(() => outcome.content, { select: outcome.select, media })) {
        toast.error(`${outcome.note ?? 'The page didn’t change.'} The ${pictures.length === 1 ? 'picture is' : 'pictures are'} in your media library.`)
        return
      }
      const many = outcome.placed > 1
      const checkAlt = many ? 'Check their descriptions on the right — screen readers read them out.' : 'Check the description on the right — screen readers read it out.'
      if (target.kind === 'replace' && !many) toast.success(`Picture replaced. ${checkAlt} Undo puts the old picture back.`)
      else if (target.kind === 'background') toast.success('Background picture set. Check the text is still easy to read. Undo takes it off.')
      else toast.success(`${plural(outcome.placed, 'picture', 'pictures')} added. ${checkAlt} Undo takes ${many ? 'them' : 'it'} away.`)
      if (outcome.note) toast.info(outcome.note)
    },
    [store, registry, context, setUploads],
  )
}
