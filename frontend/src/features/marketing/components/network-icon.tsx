import { CameraIcon } from 'lucide-react'
import type { SocialTarget } from '@/features/marketing/social-api'
import { cn } from '@/lib/utils'

/** A small mark for Facebook or Instagram (decorative: the name is always written next to it). */
export function NetworkIcon({ target, className }: { target: SocialTarget; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-5 shrink-0 items-center justify-center rounded-md text-xs font-bold text-white',
        target === 'facebook' ? 'bg-[#1877f2]' : 'bg-gradient-to-br from-[#f58529] via-[#dd2a7b] to-[#8134af]',
        className,
      )}
    >
      {target === 'facebook' ? 'f' : <CameraIcon className="size-3" />}
    </span>
  )
}
