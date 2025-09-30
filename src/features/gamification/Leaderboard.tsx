import { useEffect, useState } from 'react'
import { useGam } from '@/stores/gamification'
import { db } from '@/db'

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
      <div className="card">
        <ol className="divide-y">
          {rows.length === 0 ? (
            <li className="p-4 text-center text-gray-500">No volunteers with tokens yet</li>
          ) : (
            rows.map((r, i) => (
              <li key={r.volunteerId} className="flex items-center justify-between p-4">
                <div className="flex items-center gap-4">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                    i === 0 ? 'bg-yellow-100 text-yellow-800' :
                    i === 1 ? 'bg-gray-100 text-gray-800' :
                    i === 2 ? 'bg-orange-100 text-orange-800' :
                    'bg-blue-100 text-blue-800'
                  }`}>
                    {i + 1}
                  </div>
                  <div>
                    <div className="font-medium text-gray-900">{r.name}</div>
                    <div className="text-sm text-gray-500">Volunteer ID: {r.volunteerId}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-primary">{r.tokens}</div>
                  <div className="text-sm text-gray-500">tokens</div>
                </div>
              </li>
            ))
          )}
        </ol>
      </div>
    </div>
  )
}