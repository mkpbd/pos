/**
 * A guest's order access token (returned once by POST /store/checkout and in the
 * confirmation e-mail link as ?token=). It is kept in sessionStorage for this tab only, so a
 * refresh of the confirmation page still works after the token was taken out of the URL.
 */
const PREFIX = 'sf:order-token:'

export function rememberOrderToken(number: string, token: string): void {
  try {
    sessionStorage.setItem(PREFIX + number, token)
  } catch {
    // Storage blocked: the page works until it is reloaded.
  }
}

export function readOrderToken(number: string): string | null {
  try {
    return sessionStorage.getItem(PREFIX + number)
  } catch {
    return null
  }
}
