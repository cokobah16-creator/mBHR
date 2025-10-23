import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import { db as mbhrDb, ulid } from '@/db/mbhr';
import { useGam } from '@/stores/gamification';
import { useAuthStore } from '@/stores/auth';
import { can } from '@/auth/roles';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
export default function RestockGame() {
    const { currentUser } = useAuthStore();
    const { addTokens, ensureWallet, wallet } = useGam();
    const [items, setItems] = useState([]);
    const [deltas, setDeltas] = useState({});
    const [tokens, setTokens] = useState(0);
    // Only admins can access the restock game
    if (!currentUser || !can(currentUser.role, 'inventory')) {
        return (_jsxs("div", { className: "p-4 space-y-6", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx("h2", { className: "text-2xl font-bold text-gray-900", children: "Restock Game" }), _jsx("span", { className: "text-sm text-gray-600", children: "(Non-medical supplies)" })] }), _jsxs("div", { className: "text-center py-12", children: [_jsx(ExclamationTriangleIcon, { className: "h-12 w-12 mx-auto text-gray-400 mb-4" }), _jsx("h3", { className: "text-lg font-medium text-gray-900 mb-2", children: "Access Restricted" }), _jsx("p", { className: "text-gray-600", children: "Only administrators can access the restock game." }), _jsx("p", { className: "text-sm text-gray-500 mt-2", children: "This feature allows direct inventory modifications and requires admin privileges." })] })] }));
    }
    useEffect(() => {
        mbhrDb.inventory_nm.orderBy('itemName').toArray().then(setItems);
        ensureWallet('demo-volunteer');
    }, []);
    const low = useMemo(() => items.filter(i => i.onHandQty <= i.reorderThreshold), [items]);
    function tap(id, amount) {
        setDeltas(d => ({ ...d, [id]: (d[id] || 0) + amount }));
        setTokens(t => t + Math.max(1, Math.floor(amount / 2)));
    }
    async function commit() {
        const now = new Date().toISOString();
        await mbhrDb.transaction('rw', mbhrDb.inventory_nm, mbhrDb.stock_moves_nm, async () => {
            for (const [itemId, qty] of Object.entries(deltas)) {
                if (qty <= 0)
                    continue;
                const item = await mbhrDb.inventory_nm.get(itemId);
                if (!item)
                    continue;
                await mbhrDb.stock_moves_nm.add({
                    id: ulid(),
                    itemId,
                    qtyDelta: qty,
                    reason: 'restock',
                    createdAt: now
                });
                await mbhrDb.inventory_nm.update(itemId, {
                    onHandQty: item.onHandQty + qty,
                    updatedAt: now
                });
                await refreshAlertsFor(itemId);
            }
        });
        // Award tokens and badges
        await addTokens('demo-volunteer', tokens, tokens >= 50 ? 'swift_stocker' : undefined);
        setDeltas({});
        setTokens(0);
        setItems(await mbhrDb.inventory_nm.orderBy('itemName').toArray());
        alert('Restock committed ✅');
    }
    return (_jsxs("div", { className: "p-4 space-y-4", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx("h2", { className: "text-2xl font-bold text-gray-900", children: "Restock Game" }), _jsx("span", { className: "text-sm text-gray-600", children: "(Non-medical supplies)" })] }), _jsxs("div", { className: "bg-green-50 border border-green-200 rounded-lg p-3", children: [_jsxs("div", { className: "text-sm font-medium text-green-800", children: ["Session tokens: ", tokens, " \u2022 Wallet: ", wallet] }), _jsx("div", { className: "text-xs text-green-600", children: "Tap items to restock and earn tokens!" })] }), low.length === 0 ? (_jsxs("div", { className: "text-center py-8 text-gray-500", children: [_jsx("div", { className: "text-lg font-medium", children: "\uD83C\uDF89 All items well stocked!" }), _jsx("div", { className: "text-sm", children: "No low-stock items need restocking right now." })] })) : (_jsx("div", { className: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4", children: low.map((it) => (_jsxs("div", { className: "card border-l-4 border-l-orange-500", children: [_jsx("div", { className: "font-medium text-gray-900", children: it.itemName }), _jsxs("div", { className: "text-sm text-gray-600 mb-3", children: ["On hand: ", _jsx("span", { className: "font-semibold text-orange-600", children: it.onHandQty }), " \u2022 Threshold: ", it.reorderThreshold, " ", it.unit] }), _jsxs("div", { className: "flex gap-2 mb-2", children: [_jsx("button", { className: "btn-secondary text-sm px-3 py-1", onClick: () => tap(it.id, 1), children: "Tap +1" }), _jsx("button", { className: "btn-secondary text-sm px-3 py-1", onClick: () => tap(it.id, 5), children: "+5" }), _jsx("button", { className: "btn-secondary text-sm px-3 py-1", onClick: () => tap(it.id, 10), children: "Hold +10" })] }), deltas[it.id] && (_jsxs("div", { className: "text-xs text-blue-600 font-medium", children: ["Pending: +", deltas[it.id]] }))] }, it.id))) })), _jsxs("div", { className: "flex gap-3 pt-4 border-t", children: [_jsx("button", { className: "btn-primary", disabled: Object.keys(deltas).length === 0, onClick: commit, children: "Finish & Commit Restock" }), _jsx("button", { className: "btn-secondary", onClick: () => { setDeltas({}); setTokens(0); }, disabled: Object.keys(deltas).length === 0, children: "Clear Pending" })] })] }));
}
