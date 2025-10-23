import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { useGam } from '@/stores/gamification';
import { db } from '@/db';
export default function Leaderboard() {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        (async () => {
            setLoading(true);
            const base = await useGam.getState().leaderboard('all', 50);
            // try to attach display names from local users (fallback to id)
            const users = await db.users.toArray();
            const byId = new Map(users.map(u => [u.id, u.fullName ?? u.id]));
            setRows(base.map(r => ({ ...r, name: byId.get(r.volunteerId) ?? r.volunteerId })));
            setLoading(false);
        })();
    }, []);
    if (loading)
        return _jsx("div", { className: "p-6", children: "Loading leaderboard\u2026" });
    return (_jsxs("div", { className: "p-6", children: [_jsx("h1", { className: "text-2xl font-semibold mb-4", children: "Volunteer Leaderboard" }), _jsx("ol", { className: "divide-y rounded-2xl border", children: rows.map((r, i) => (_jsxs("li", { className: "flex items-center justify-between p-3", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: "w-8 text-center font-mono", children: i + 1 }), _jsx("span", { className: "font-medium", children: r.name })] }), _jsxs("div", { className: "text-sm", children: [_jsx("span", { className: "font-semibold", children: r.tokens }), " tokens"] })] }, r.volunteerId))) })] }));
}
