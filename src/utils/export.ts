// CSV/JSON export utilities for data export functionality
import type { Table } from 'dexie'

function toCSV(rows: any[]) {
  if (!rows.length) return ''
  const headers = Object.keys(rows[0])
  const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`
  return [
    headers.join(','), 
    ...rows.map(r => headers.map(h => esc(r[h])).join(','))
  ].join('\n')
}

export async function exportTable<T>(
  table: Table<T, any>, 
  filename: string, 
  type: 'csv' | 'json' = 'csv'
) {
  const rows = await table.toArray()
  const blob = type === 'json' 
    ? new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' })
    : new Blob([toCSV(rows as any)], { type: 'text/csv' })
  
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}