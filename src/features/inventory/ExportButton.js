import { jsx as _jsx } from "react/jsx-runtime";
import { db } from '@/db/mbhr';
import { toCsv, download } from '@/utils/csv';
export default function ExportInventoryCsv() {
    async function run() {
        const items = await db.inventory_nm.orderBy('itemName').toArray();
        const rows = items.map(i => ({
            id: i.id,
            item_name: i.itemName,
            unit: i.unit,
            on_hand_qty: i.onHandQty,
            reorder_threshold: i.reorderThreshold,
            updated_at: i.updatedAt
        }));
        download(`inventory-nm-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows));
    }
    return (_jsx("button", { onClick: run, className: "btn btn-outline", children: "Export CSV" }));
}
