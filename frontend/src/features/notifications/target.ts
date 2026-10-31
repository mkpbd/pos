/** In-app path of a notification (`url`, or `link` on older alerts); anything but a same-origin path is ignored. */
export function notificationTarget(data: { link?: unknown; url?: unknown }): string | null {
  const target = data.url ?? data.link
  return typeof target === 'string' && target.startsWith('/') && !target.startsWith('//') ? target : null
}
