function toCSV(rows) {
    if (!rows.length)
        return '';
    const headers = Object.keys(rows[0]);
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    return [
        headers.join(','),
        ...rows.map(r => headers.map(h => esc(r[h])).join(','))
    ].join('\n');
}
export async function exportTable(table, filename, type = 'csv') {
    const rows = await table.toArray();
    const blob = type === 'json'
        ? new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' })
        : new Blob([toCSV(rows)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}
