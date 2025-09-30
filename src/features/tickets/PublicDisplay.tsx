import { useEffect, useState } from 'react'
import { liveQuery } from 'dexie'
import { db } from '@/db/mbhr'

type Stage = 'registration'|'vitals'|'consult'|'pharmacy'
const STAGES: Stage[] = ['registration','vitals','consult','pharmacy']

type Lane = { stage: Stage; current?: string; next: string[] }

export default function PublicDisplay() {
  const [lanes, setLanes] = useState<Lane[]>([])

  useEffect(() => {
    const sub = liveQuery(async () => {
      const lanes: Lane[] = []
      for (const stage of STAGES) {
        const current = await db.tickets
          .where({ currentStage: stage, state: 'in_progress' })
          .reverse() // newest wins if multiple
          .sortBy('createdAt').then(arr => arr.at(-1)?.number)

        const next = await db.tickets
          .where({ currentStage: stage, state: 'waiting' })
          .limit(3)
          .sortBy('createdAt').then(arr => arr.map(t => t.number))

        lanes.push({ stage, current, next })
      }
      return lanes
    }).subscribe(setLanes)

    return () => sub.unsubscribe()
  }, [])

  return (
    <div className="min-h-screen bg-black text-white p-8 font-semibold">
      <h1 className="text-4xl mb-6">Now Serving</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {lanes.map(l => (
          <div key={l.stage} className="rounded-2xl p-6 bg-zinc-900 border border-zinc-700">
            <div className="text-zinc-400 text-xl capitalize">{l.stage}</div>
            <div className="text-5xl md:text-6xl my-2 tabular-nums">
              {l.current ?? '—'}
            </div>
            <div className="text-zinc-400 text-sm">Up next</div>
            <div className="flex gap-3 text-2xl mt-1 tabular-nums">
              {l.next.length ? l.next.map(n => <span key={n}>{n}</span>) : <span>—</span>}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-6 text-zinc-500 text-sm">Auto-updates offline via IndexedDB</div>
    </div>
  )
}