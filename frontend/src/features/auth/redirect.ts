/** Only same-app relative paths are accepted as post-sign-in targets (no open redirects). */
export function safeRedirect(target: string | null): string {
  return target && target.startsWith('/') && !target.startsWith('//') ? target : '/'
}

/** G1a: full-screen two-factor setup, the only screen open while the organization requires it and it is off. */
export const TWO_FACTOR_SETUP_PATH = '/two-factor/setup'
