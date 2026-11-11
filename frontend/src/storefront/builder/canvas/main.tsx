import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { onlineManager, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { CanvasApp } from './canvas-app'
import { createCanvasQueryClient } from './query-client'
import '../../storefront.css'

/*
 * Entry of builder-canvas.html (/admin/builder-canvas): the storefront renderer alone, for the
 * store builder editor's iframe. Outside an iframe there is no editor to talk to.
 */

// The canvas never talks to the store API: queries stay paused, mutations never run.
onlineManager.setEventListener(() => () => {})
onlineManager.setOnline(false)

const queryClient = createCanvasQueryClient()
// Links in the canvas never navigate (clicks are swallowed); the memory router only gives them a context.
const router = createMemoryRouter([{ path: '*', element: <CanvasApp /> }])

const root = document.getElementById('root')
if (!root) throw new Error('Root element #root not found')

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
