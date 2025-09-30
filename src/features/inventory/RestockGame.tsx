import React, { useEffect, useMemo, useState } from 'react'
import { db as mbhrDb, ulid } from '@/db/mbhr'
import { useGam } from '@/stores/gamification'

type Delta = Record<string, number>

export default function RestockGame() {
  const { addTokens, ensureWallet, wallet } = useGam()
  const [items, setItems] = useState<any[]>([])
  const [deltas, setDeltas] = useState<Delta>({})
  const [tokens, setTokens] = useState(0)

  useEffect(() => {
    mbhrDb.inventory_nm.orderBy('itemName').toArray().then(setItems)
    ensureWallet('demo-volunteer')
  }, [])

  const low = useMemo(
    () => items.filter(i => i.onHandQty <= i.reorderThreshold),
    [items]
  )

  function tap(id: string, amount: number) {
    setDeltas(d => ({ ...d, [id]: (d[id] || 0) + amount }))
    setTokens(t => t + Math.max(1, Math.floor(amount / 2)))
  }

  async function commit() {
    const now = new Date().toISOString()
    await mbhrDb.transaction('rw', mbhrDb.inventory_nm, mbhrDb.stock_moves_nm, async () => {
      for (const [itemId, qty] of Object.entries(deltas)) {
        if (qty <= 0) continue
        const item = await mbhrDb.inventory_nm.get(itemId)
        if (!item) continue
        await mbhrDb.stock_moves_nm.add({
          id: ulid(),
          itemId,
          qtyDelta: qty,
          reason: 'restock',
          createdAt: now
        })
        await mbhrDb.inventory_nm.update(itemId, {
          onHandQty: item.onHandQty + qty,
          updatedAt: now
        })
        await refreshAlertsFor(itemId)
      }
    })
    
    // Award tokens and badges
    await addTokens('demo-volunteer', tokens, tokens >= 50 ? 'swift_stocker' : undefined)
    
    setDeltas({})
    setTokens(0)
    setItems(await mbhrDb.inventory_nm.orderBy('itemName').toArray())
    alert('Restock committed ✅')
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center space-x-3">
        <h2 className="text-2xl font-bold text-gray-900">Restock Game</h2>
        <span className="text-sm text-gray-600">(Non-medical supplies)</span>
      </div>
      <div className="bg-green-50 border border-green-200 rounded-lg p-3">
        <div className="text-sm font-medium text-green-800">
          Session tokens: {tokens} • Wallet: {wallet}
        </div>
        <div className="text-xs text-green-600">Tap items to restock and earn tokens!</div>
      </div>

      {low.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <div className="text-lg font-medium">🎉 All items well stocked!</div>
          <div className="text-sm">No low-stock items need restocking right now.</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {low.map((it) => (
            <div key={it.id} className="card border-l-4 border-l-orange-500">
              <div className="font-medium text-gray-900">{it.itemName}</div>
              <div className="text-sm text-gray-600 mb-3">
                On hand: <span className="font-semibold text-orange-600">{it.onHandQty}</span> • 
                Threshold: {it.reorderThreshold} {it.unit}
              </div>
              <div className="flex gap-2 mb-2">
                <button 
                  className="btn-secondary text-sm px-3 py-1" 
                  onClick={() => tap(it.id, 1)}
                >
                  Tap +1
                </button>
                <button 
                  className="btn-secondary text-sm px-3 py-1" 
                  onClick={() => tap(it.id, 5)}
                >
                  +5
                </button>
                <button 
                  className="btn-secondary text-sm px-3 py-1" 
                  onClick={() => tap(it.id, 10)}
                >
                  Hold +10
                </button>
              </div>
              {deltas[it.id] && (
                <div className="text-xs text-blue-600 font-medium">
                  Pending: +{deltas[it.id]}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-3 pt-4 border-t">
        <button 
          className="btn-primary" 
          disabled={Object.keys(deltas).length === 0} 
          onClick={commit}
        >
          Finish & Commit Restock
        </button>
        <button 
          className="btn-secondary" 
          onClick={() => { setDeltas({}); setTokens(0) }}
          disabled={Object.keys(deltas).length === 0}
        >
          Clear Pending
        </button>
      </div>
    </div>
  )
}