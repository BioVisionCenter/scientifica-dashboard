import { useAppStore } from '../stores/appStore'
import { LeaderboardBoard } from '../components/leaderboard/LeaderboardBoard'

export default function LeaderboardPage() {
  const entries = useAppStore((s) => s.entries)
  return (
    <div className="mx-auto max-w-3xl overflow-y-auto px-8 py-8" style={{ maxHeight: '100%' }}>
      <LeaderboardBoard entries={entries} limit={30} />
    </div>
  )
}
