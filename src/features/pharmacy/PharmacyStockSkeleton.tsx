import { useEffect, useMemo, useState } from 'react'
import { db } from '@/db/mbhr'
import { ulid } from '@/db/mbhr'

type Row = {
  id: string
  medName: string
  unit: string
  onHandQty: number
  batches: number
  earliestExpiry?: string
}

export default function PharmacyStockSkeleton() {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [showBatch, setShowBatch] = useState<string|null>(null)

  useEffect(() => {
    let dead = false
    ;(async () => {
      const items = await db.pharmacy_items.orderBy('medName').toArray()
      const batches = await db.pharmacy_batches.toArray()
      const byItem = new Map<string, {count:number; earliest?:string}>()
      for (const b of batches) {
        const entry = byItem.get(b.itemId) ?? { count:0 as number, earliest: undefined as string|undefined }
        entry.count += 1
        if (!entry.earliest || b.expiryDate < entry.earliest) entry.earliest = b.expiryDate
        byItem.set(b.itemId, entry)
      }
      const rows: Row[] = items.map(i => ({
        id: i.id,
        medName: [i.medName, i.strength].filter(Boolean).join(' '),
        unit: i.unit,
        onHandQty: i.onHandQty,
        batches: byItem.get(i.id)?.count ?? 0,
        earliestExpiry: byItem.get(i.id)?.earliest
      }))
      if (!dead) setRows(rows)
    })()
    return () => { dead = true }
  }, [])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? rows.filter(r => r.medName.toLowerCase().includes(s)) : rows
  }, [q, rows])

  async function addItem(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const medName = String(fd.get('medName')||'').trim()
    const strength = String(fd.get('strength')||'').trim()
    const unit = String(fd.get('unit')||'tabs')
    if (!medName) return
    const now = new Date().toISOString()
    const obj = { id: ulid(), medName, strength, unit, form: 'tab', onHandQty: 0, reorderThreshold: 0, updatedAt: now }
    await db.pharmacy_items.add(obj as any)
    setShowAdd(false)
    // refresh
    const all = await db.pharmacy_items.orderBy('medName').toArray()
    setRows(all.map(i => ({
      id: i.id, medName: [i.medName,i.strength].filter(Boolean).join(' '),
      unit: i.unit, onHandQty: i.onHandQty, batches: 0
    })))
  }

  async function addBatch(itemId: string, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const lotNumber = String(fd.get('lot')||'').trim()
    const qty = Number(fd.get('qty')||0)
    const expiry = String(fd.get('expiry')||'')
    if (!lotNumber || !qty || !expiry) return
    await db.transaction('rw', db.pharmacy_batches, db.pharmacy_items, async () => {
      await db.pharmacy_batches.add({
        id: ulid(), itemId, lotNumber, qtyOnHand: qty,
        expiryDate: expiry, receivedAt: new Date().toISOString()
      } as any)
      const item = await db.pharmacy_items.get(itemId)
      if (item) await db.pharmacy_items.update(itemId, { onHandQty: (item.onHandQty||0)+qty, updatedAt: new Date().toISOString() })
    })
    setShowBatch(null)
    // soft refresh
    const items = await db.pharmacy_items.orderBy('medName').toArray()
    setRows(prev => items.map(i => {
      const old = prev.find(p => p.id === i.id)
      return {
        id: i.id,
        medName: [i.medName,i.strength].filter(Boolean).join(' '),
        unit: i.unit,
        onHandQty: i.onHandQty,
        batches: old?.batches ?? 0
      }
    }))
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Pharmacy Stock</h1>
        <div className="flex gap-2">
          <button className="btn btn-outline" onClick={()=>setShowAdd(true)}>Add Item</button>
        </div>
      </div>

      <div className="mt-4">
        <input className="input input-bordered w-full" placeholder="Search (e.g. Paracetamol 500mg)" value={q} onChange={e=>setQ(e.target.value)} />
      </div>

      <div className="mt-4 overflow-x-auto rounded-2xl border">
        <table className="min-w-full text-sm">
          <thead className="bg-zinc-50">
            <tr>
              <th className="p-3 text-left">Drug</th>
              <th className="p-3">Unit</th>
              <th className="p-3">On hand</th>
              <th className="p-3">Batches</th>
              <th className="p-3">Earliest Exp.</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => (
              <tr key={r.id} className="border-t">
                <td className="p-3">{r.medName}</td>
                <td className="p-3 text-center">{r.unit}</td>
                <td className="p-3 text-center tabular-nums">{r.onHandQty}</td>
                <td className="p-3 text-center">{r.batches}</td>
                <td className="p-3 text-center">{r.earliestExpiry ?? '—'}</td>
                <td className="p-3 text-right">
                  <button className="btn btn-primary btn-sm" onClick={()=>setShowBatch(r.id)}>Add Batch</button>
                </td>
              </tr>
            ))}
            {!filtered.length && (
              <tr><td className="p-6 text-center text-zinc-500" colSpan={6}>No items</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add Item modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4">
          <form className="bg-white rounded-2xl p-5 w-full max-w-md space-y-3" onSubmit={addItem}>
            <h2 className="text-lg font-semibold mb-2">New Item</h2>
            <input name="medName" className="input input-bordered w-full" placeholder="e.g. Paracetamol" />
            <input name="strength" className="input input-bordered w-full" placeholder="e.g. 500mg" />
            <input name="unit" className="input input-bordered w-full" defaultValue="tabs" />
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" className="btn" onClick={()=>setShowAdd(false)}>Cancel</button>
              <button className="btn btn-primary">Save</button>
            </div>
          </form>
        </div>
      )}

      {/* Add Batch modal */}
      {showBatch && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4">
          <form className="bg-white rounded-2xl p-5 w-full max-w-md space-y-3" onSubmit={(e)=>addBatch(showBatch, e)}>
            <h2 className="text-lg font-semibold mb-2">Add Batch</h2>
            <input name="lot" className="input input-bordered w-full" placeholder="Lot number" />
            <input name="qty" type="number" min={1} className="input input-bordered w-full" placeholder="Quantity" />
            <input name="expiry" type="date" className="input input-bordered w-full" />
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" className="btn" onClick={()=>setShowBatch(null)}>Cancel</button>
              <button className="btn btn-primary">Add</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}