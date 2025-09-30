// src/sync/adapter.ts
import { createClient } from '@supabase/supabase-js';
import { db } from '../db';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

const sb = (url && key) ? createClient(url, key, { auth: { persistSession: false } }) : null;

type Cursor = { ts: string }; // ISO timestamp

export async function getCursor(): Promise<Cursor> {
  const row = await db.settings.get('sync_cursor');
  return row?.value ? JSON.parse(row.value) : { ts: '1970-01-01T00:00:00Z' };
}

export async function setCursor(c: Cursor) {
  await db.settings.put({ key: 'sync_cursor', value: JSON.stringify(c) });
}

const tables = ['patients','visits','vitals','consultations','dispenses','inventory','queue'] as const;

export async function pushChanges() {
  if (!sb) return; // offline or not configured
  
  try {
    // Naive: upsert any rows with local _dirty flag or missing _syncedAt
    for (const t of tables) {
      const rows = await (db as any)[t].where('_dirty').equals(1).toArray().catch(() => []);
      if (!rows?.length) continue;
      
      const payload = rows.map(({ _dirty, _deleted, ...r }: any) => r);
      const { error } = await sb.from(t).upsert(payload, { onConflict: 'id' });
      
      if (!error) {
        await (db as any)[t].where('_dirty').equals(1).modify({ 
          _dirty: 0, 
          _syncedAt: new Date().toISOString() 
        });
      }
    }
  } catch (error) {
    console.error('Push changes failed:', error);
  }
}

export async function pullChanges() {
  if (!sb) return;
  
  try {
    const cur = await getCursor();
    let maxTs = cur.ts;
    
    for (const t of tables) {
      const { data, error } = await sb.from(t).select('*').gt('updated_at', cur.ts).limit(1000);
      if (error) continue;
      
      for (const row of data ?? []) {
        // last-write-wins
        await (db as any)[t].put({ 
          ...row, 
          _dirty: 0, 
          _syncedAt: new Date().toISOString() 
        });
        
        if (row.updated_at && row.updated_at > maxTs) {
          maxTs = row.updated_at;
        }
      }
    }
    
    await setCursor({ ts: maxTs });
  } catch (error) {
    console.error('Pull changes failed:', error);
  }
}

export function isOnlineSyncEnabled() {
  return !!sb && navigator.onLine;
}

export function isConfigured() {
  return !!sb;
}

// Auto-sync helper
export async function syncNow() {
  if (!isOnlineSyncEnabled()) return;
  
  try {
    await pushChanges();
    await pullChanges();
    console.log('Sync completed successfully');
  } catch (error) {
    console.error('Sync failed:', error);
  }
}