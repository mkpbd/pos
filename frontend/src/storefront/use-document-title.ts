import { useEffect } from 'react'
import { useStorefront } from './api'

/** "Title | Store name" in the browser tab (the server writes it on first load in production). */
export function useDocumentTitle(title: string | null | undefined) {
  const { store } = useStorefront()
  useEffect(() => {
    if (title) document.title = `${title} | ${store.name}`
  }, [title, store.name])
}
