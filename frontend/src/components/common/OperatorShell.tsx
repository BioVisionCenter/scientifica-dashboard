import { NavLink, Outlet } from 'react-router-dom'
import { useAppStore } from '../../stores/appStore'
import { useWebsocket } from '../../api/ws'
import { useSound } from '../../lib/sound'
import { EventMark } from './EventMark'
import { PoweredBy } from './PoweredBy'

const LINKS = [
  { to: '/admin', label: 'Game admin' },
  { to: '/explore', label: 'Explore' },
  { to: '/leaderboard', label: 'Leaderboard' },
]

/** Shared chrome for operator pages: nav, connection state, credits. */
export function OperatorShell() {
  useWebsocket('admin')
  const connected = useAppStore((s) => s.connected)
  const sound = useSound()

  return (
    <div className="flex h-full flex-col">
      <div
        className="flex items-center gap-5 px-4 py-2"
        style={{ borderBottom: 'var(--ngio-border)' }}
      >
        <EventMark size={22} />
        <nav className="flex gap-1.5">
          {LINKS.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) => `btn ${isActive ? 'btn-active' : ''}`}
              style={{ padding: '6px 12px', fontSize: 13, textDecoration: 'none' }}
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-4">
          <button
            className="btn"
            style={{ padding: '5px 10px', fontSize: 12 }}
            onClick={sound.toggle}
            title="Sound cues on the reveal (no audio assets yet)"
          >
            {sound.enabled ? '🔊 sound on' : '🔇 sound off'}
          </button>
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            title={connected ? 'connected' : 'disconnected'}
            style={{ background: connected ? 'var(--ngio-green)' : 'var(--ngio-magenta)' }}
          />
          <PoweredBy />
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <Outlet />
      </div>
    </div>
  )
}
