export function toCsv(rows: Record<string, any>[]): string {
  if (!rows.length) return ''
  const cols = Array.from(new Set(rows.flatMap(r => Object.keys(r))))
  const esc = (v: any) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s
  }
  const head = cols.map(esc).join(',')
  const body = rows.map(r => cols.map(c => esc(r[c])).join(',')).join('\n')
  return head + '\n' + body
}

export function download(filename: string, text: string, mime = 'text/csv') {
  const blob = new Blob([text], { type: mime + ';charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}