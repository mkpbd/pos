const BROWSERS: [RegExp, string][] = [
  [/Edg(e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
]

const SYSTEMS: [RegExp, string][] = [
  [/Android/, 'Android'],
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Windows/, 'Windows'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
]

/** A short "Chrome on Windows" summary of a user agent; the raw string stays available as a tooltip. */
export function deviceSummary(userAgent: string | null | undefined): string {
  if (!userAgent) return 'Unknown device'
  const browser = BROWSERS.find(([re]) => re.test(userAgent))?.[1]
  const system = SYSTEMS.find(([re]) => re.test(userAgent))?.[1]
  if (browser && system) return `${browser} on ${system}`
  if (browser ?? system) return (browser ?? system) as string
  return userAgent.length > 40 ? `${userAgent.slice(0, 40)}…` : userAgent
}
