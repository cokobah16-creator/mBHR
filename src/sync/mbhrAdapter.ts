// src/sync/mbhrAdapter.ts
import { db as mbhrDb } from '@/db/mbhr'

export const isOnlineSyncEnabled = () => localStorage.getItem('mbhr-sync') === 'on'
export const setOnlineSync = (on: boolean) => localStorage.setItem('mbhr-sync', on ? 'on' : 'off')

// TODO: inject your supabase client here
let supabase: any = null
export const setSupabaseClient = (client: any) => { supabase = client }

export async function syncNow() {
  if (!supabase) return console.log('[sync] supabase client not set — skipped')

  // example: push inventory_nm (minimal demo; extend for other tables)
  const changed = await mbhrDb.inventory_nm.toArray() // replace with "since cursor"
  if (changed.length) {
    const { error } = await supabase.from('inventory_nm').upsert(
      changed.map(x => ({
        id: x.id,
        item_name: x.itemName,
        unit: x.unit,
        on_hand_qty: x.onHandQty,
        reorder_threshold: x.reorderThreshold,
        min_qty: x.minQty ?? null,
        max_qty: x.maxQty ?? null,
        updated_at: x.updatedAt,
        site_id: x.siteId ?? null,
      })),
      { onConflict: 'id' }
    )
    if (error) console.error('[sync] push inventory_nm failed', error)
  }

  // pull could select rows updated_after cursor
  console.log('[sync] done')
}