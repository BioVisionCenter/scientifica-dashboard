import { useWebsocket } from '../api/ws'
import { useAppStore } from '../stores/appStore'
import { LeaderboardBoard } from '../components/leaderboard/LeaderboardBoard'
import { Wordmark } from '../components/common/Wordmark'

export default function LeaderboardPage() {
  useWebsocket('admin')
  const entries = useAppStore((s) => s.entries)
  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <div className="mb-8 flex items-center justify-between">
        <Wordmark size={30} label="leaderboard" />
      </div>
      <LeaderboardBoard entries={entries} limit={30} />
    </div>
  )
}
