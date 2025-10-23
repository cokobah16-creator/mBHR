import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { db } from '@/db/mbhr';
const STAGES = ['registration', 'vitals', 'consult', 'pharmacy'];
export default function PublicDisplay() {
    const [lanes, setLanes] = useState([]);
    useEffect(() => {
        const sub = liveQuery(async () => {
            const lanes = [];
            for (const stage of STAGES) {
                const current = await db.tickets
                    .where({ currentStage: stage, state: 'in_progress' })
                    .reverse() // newest wins if multiple
                    .sortBy('createdAt').then(arr => arr.at(-1)?.number);
                const next = await db.tickets
                    .where({ currentStage: stage, state: 'waiting' })
                    .limit(3)
                    .sortBy('createdAt').then(arr => arr.map(t => t.number));
                lanes.push({ stage, current, next });
            }
            return lanes;
        }).subscribe(setLanes);
        return () => sub.unsubscribe();
    }, []);
    return (_jsxs("div", { className: "min-h-screen bg-black text-white p-8 font-semibold", children: [_jsx("h1", { className: "text-4xl mb-6", children: "Now Serving" }), _jsx("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-6", children: lanes.map(l => (_jsxs("div", { className: "rounded-2xl p-6 bg-zinc-900 border border-zinc-700", children: [_jsx("div", { className: "text-zinc-400 text-xl capitalize", children: l.stage }), _jsx("div", { className: "text-5xl md:text-6xl my-2 tabular-nums", children: l.current ?? '—' }), _jsx("div", { className: "text-zinc-400 text-sm", children: "Up next" }), _jsx("div", { className: "flex gap-3 text-2xl mt-1 tabular-nums", children: l.next.length ? l.next.map(n => _jsx("span", { children: n }, n)) : _jsx("span", { children: "\u2014" }) })] }, l.stage))) }), _jsx("div", { className: "mt-6 text-zinc-500 text-sm", children: "Auto-updates offline via IndexedDB" })] }));
}
