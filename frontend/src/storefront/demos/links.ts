/** A host name, optionally with a port: letters, digits, dots and hyphens only. */
const HOST = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?$/i

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i

type PageLocation = Pick<Location, 'protocol' | 'port' | 'origin'>

/**
 * The home page of a demo store: the gallery's scheme and port with the demo's host
 * (`http://vegan.shop.localhost:5173/` from a dev server on 5173). A host that already names a
 * port keeps it. Null for a value that is not a host name, so no odd URL is ever linked.
 */
export function demoStoreUrl(host: string, location: PageLocation = window.location): string | null {
  const value = host.trim()
  if (!HOST.test(value)) return null
  const port = !value.includes(':') && location.port ? `:${location.port}` : ''
  return `${location.protocol}//${value.toLowerCase()}${port}/`
}

/** The back office on this server (the gallery's own origin). */
export function demoAdminUrl(location: PageLocation = window.location): string {
  return `${location.origin}/admin`
}

/** A theme colour from the API when it is a hex colour; else null (the swatch is left out). */
export function safeColor(value: string | null | undefined): string | null {
  return typeof value === 'string' && HEX_COLOR.test(value) ? value : null
}
