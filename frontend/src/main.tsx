import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import './index.css'
import Tv from './routes/Tv'
import Explore from './routes/Explore'
import Admin from './routes/Admin'
import LeaderboardPage from './routes/LeaderboardPage'
import Home from './routes/Home'

const router = createBrowserRouter([
  { path: '/', element: <Home /> },
  { path: '/tv', element: <Tv /> },
  { path: '/explore', element: <Explore /> },
  { path: '/admin', element: <Admin /> },
  { path: '/leaderboard', element: <LeaderboardPage /> },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
