/** Relative time for sqlite timestamps (UTC-naive: 'YYYY-MM-DD HH:MM:SS'). */
export function timeAgo(sqliteUtc: string): string {
  const iso = sqliteUtc.includes('T') ? sqliteUtc : sqliteUtc.replace(' ', 'T') + 'Z'
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 45) return 'just now'
  if (seconds < 90) return '1 min ago'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  return hours === 1 ? '1 h ago' : `${hours} h ago`
}
