import { Link } from 'react-router-dom'
import { EventMark } from '../components/common/EventMark'
import { PoweredBy } from '../components/common/PoweredBy'

const LINKS = [
  { to: '/admin', title: 'Game admin', desc: 'Run the counting game: stopwatch, entries, TV control' },
  { to: '/explore', title: 'Explore', desc: 'Step through the analysis pipeline on the operator screen' },
  { to: '/tv', title: 'TV', desc: 'Fullscreen kiosk view — open this on the big screen' },
  { to: '/leaderboard', title: 'Leaderboard', desc: 'Standalone ranked board' },
]

export default function Home() {
  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col justify-center gap-8 px-8">
      <EventMark size={42} />
      <div className="grid grid-cols-2 gap-4">
        {LINKS.map((l) => (
          <Link
            key={l.to}
            to={l.to}
            className="card p-6 no-underline transition-all hover:-translate-y-0.5"
            style={{ color: 'inherit' }}
          >
            <div className="font-display text-xl font-semibold" style={{ letterSpacing: '-0.022em' }}>
              {l.title}
            </div>
            <div className="mt-2 text-sm" style={{ color: 'var(--ngio-muted)' }}>
              {l.desc}
            </div>
          </Link>
        ))}
      </div>
      <PoweredBy />
    </div>
  )
}
