import { useEffect, useState } from 'react'
import { useGam } from '@/stores/gamification'
import { db } from '@/db/mbhr'

type Row = { volunteerId: string; tokens: number; name: string }

export default function Leaderboard() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      setLoading(true)
      const base = await useGam.getState().leaderboard('all', 50)
      // try to attach display names from local users (fallback to id)
      const users = await db.users.toArray()
      const byId = new Map(users.map(u => [u.id, u.fullName ?? u.id]))
      setRows(base.map(r => ({ ...r, name: byId.get(r.volunteerId) ?? r.volunteerId })))
      setLoading(false)
    })()
  }, [])

  if (loading) return <div className="p-6">Loading leaderboard…</div>

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Volunteer Leaderboard</h1>
      <ol className="divide-y rounded-2xl border">
        {rows.map((r, i) => (
          <li key={r.volunteerId} className="flex items-center justify-between p-3">
            <div className="flex items-center gap-3">
              <span className="w-8 text-center font-mono">{i + 1}</span>
              <span className="font-medium">{r.name}</span>
            </div>
            <div className="text-sm"><span className="font-semibold">{r.tokens}</span> tokens</div>
          </li>
        ))}
      </ol>
    </div>
  )
}