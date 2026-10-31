import type { Announcement } from '../types'
import { MenuLink } from './menu-link'

export function AnnouncementBar({ announcement }: { announcement: Announcement }) {
  const style = { backgroundColor: announcement.background, color: announcement.foreground }

  return (
    <div className="px-4 py-2 text-center text-sm font-medium" style={style} data-testid="announcement-bar">
      {announcement.link ? (
        <MenuLink url={announcement.link} newTab={!announcement.link.startsWith('/')} className="underline-offset-4 hover:underline">
          {announcement.text}
        </MenuLink>
      ) : (
        <p>{announcement.text}</p>
      )}
    </div>
  )
}

export function PreviewRibbon() {
  return (
    <div role="status" className="bg-neutral-900 px-4 py-1.5 text-center text-xs font-semibold text-white">
      Preview — this store is not open to customers yet.
    </div>
  )
}
