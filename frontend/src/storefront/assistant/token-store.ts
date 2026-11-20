/*
 * AI2b: the browser keeps only the conversation's random token (the server stores its hash). Storage can
 * be missing, full or blocked (private windows, cookies off): every access is guarded, and without it the
 * chat simply lasts as long as the page.
 */

export const ASSISTANT_TOKEN_KEY = 'sf-assistant-conversation'

/** A token as the server issues it (hex or base64, 16–200 characters); anything else in storage is ignored. */
const TOKEN = /^[A-Za-z0-9._~+/=-]{16,200}$/

export function readAssistantToken(): string | null {
  try {
    const value = window.localStorage.getItem(ASSISTANT_TOKEN_KEY)
    return value && TOKEN.test(value) ? value : null
  } catch {
    return null
  }
}

export function writeAssistantToken(token: string | null): void {
  try {
    if (token && TOKEN.test(token)) window.localStorage.setItem(ASSISTANT_TOKEN_KEY, token)
    else window.localStorage.removeItem(ASSISTANT_TOKEN_KEY)
  } catch {
    // Storage blocked or full: the chat is not remembered after a reload.
  }
}
