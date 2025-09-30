import { useEffect, useRef } from 'react'
import { liveQuery } from 'dexie'
import { db as mbhrDb, ulid } from '@/db/mbhr'
import { useToast } from '@/stores/toast'

/** Show a toast at most once per item per hour */
export default function useLowStockWatcher() {
  const push = useToast(s => s.push)
  const last = useRef<Map<string, number>>(new Map())

  useEffect(() => {
    const sub = liveQuery(() => mbhrDb.inventory_nm.toArray()).subscribe(items => {
      const now = Date.now()
      items.forEach(it => {
        if (it.onHandQty <= it.reorderThreshold) {
          const prev = last.current.get(it.id) ?? 0
          if (now - prev > 60 * 60 * 1000) { // 1 hour cooldown
            last.current.set(it.id, now)
            push({
              id: ulid(),
              title: `Low stock: ${it.itemName}`,
              body: `On hand ${it.onHandQty} ≤ threshold ${it.reorderThreshold}`,
              type: 'warning'
            })
          }
        }
      })
    })
    return () => sub.unsubscribe()
  }, [push])
}