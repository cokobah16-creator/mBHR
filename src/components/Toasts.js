import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useToast } from '@/stores/toast';
export default function Toasts() {
    const items = useToast(s => s.items);
    const remove = useToast(s => s.remove);
    return (_jsx("div", { className: "fixed bottom-4 right-4 z-50 flex flex-col gap-2", children: items.map(t => (_jsx("div", { className: "rounded-xl bg-white shadow-lg border p-3 w-80", children: _jsxs("div", { className: "flex justify-between items-start", children: [_jsxs("div", { className: "flex-1", children: [_jsx("div", { className: "font-medium", children: t.title }), t.body && _jsx("div", { className: "text-sm opacity-70", children: t.body })] }), _jsx("button", { onClick: () => remove(t.id), className: "ml-2 text-gray-400 hover:text-gray-600", children: "\u00D7" })] }) }, t.id))) }));
}
