import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import './index.css'
import Tv from './routes/Tv'
import Admin from './routes/Admin'
import { useAppStore } from './stores/appStore'
import type { ThemeMode } from './api/types'

// Theme is applied on <html> so both pages and the pre-hydration frame agree.
// The attribute is ALWAYS explicit ("light"|"dark") — never absent — so the
// prefers-color-scheme media block in colors.css can never override the choice.
const applyTheme = (t: ThemeMode) => {
  document.documentElement.setAttribute('data-ngio-theme', t)
  localStorage.setItem('ccc-theme', t)
}
const cached = localStorage.getItem('ccc-theme')
if (cached === 'light' || cached === 'dark') applyTheme(cached)
useAppStore.subscribe((s, prev) => {
  if (s.theme !== prev.theme) applyTheme(s.theme)
})

const router = createBrowserRouter([
  { path: '/tv', element: <Tv /> },
  { path: '/admin', element: <Admin /> },
  { path: '*', element: <Navigate to="/admin" replace /> },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
