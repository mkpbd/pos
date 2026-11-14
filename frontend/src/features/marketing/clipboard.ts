import { toast } from 'sonner'

export async function copyText(text: string, done = 'Link copied.') {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(done)
  } catch {
    toast.error('Copying failed. Select the link and copy it by hand.')
  }
}
