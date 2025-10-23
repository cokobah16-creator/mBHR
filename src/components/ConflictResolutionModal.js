import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { ExclamationTriangleIcon, XMarkIcon } from '@heroicons/react/24/outline';
export function ConflictResolutionModal({ conflict, onResolve, onCancel, }) {
    const [strategy, setStrategy] = useState('keep-local');
    const [manualResolution, setManualResolution] = useState(() => {
        const initial = {};
        conflict.conflicts.forEach((c) => {
            initial[c.field] = 'local';
        });
        return initial;
    });
    const formatValue = (value, type) => {
        if (value === null || value === undefined)
            return '(empty)';
        switch (type) {
            case 'date':
                return new Date(value).toLocaleString();
            case 'object':
                return JSON.stringify(value, null, 2);
            case 'number':
                return String(value);
            default:
                return String(value);
        }
    };
    const handleResolve = () => {
        if (strategy === 'manual') {
            onResolve(strategy, manualResolution);
        }
        else {
            onResolve(strategy);
        }
    };
    const toggleFieldResolution = (field) => {
        setManualResolution((prev) => ({
            ...prev,
            [field]: prev[field] === 'local' ? 'remote' : 'local',
        }));
    };
    return (_jsx("div", { className: "fixed inset-0 z-50 overflow-y-auto", children: _jsxs("div", { className: "flex min-h-screen items-center justify-center p-4", children: [_jsx("div", { className: "fixed inset-0 bg-black/50 transition-opacity", onClick: onCancel }), _jsxs("div", { className: "relative w-full max-w-4xl rounded-lg bg-white p-6 shadow-xl", children: [_jsxs("div", { className: "mb-6 flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx("div", { className: "flex h-12 w-12 items-center justify-center rounded-full bg-yellow-100", children: _jsx(ExclamationTriangleIcon, { className: "h-6 w-6 text-yellow-600" }) }), _jsxs("div", { children: [_jsx("h2", { className: "text-2xl font-bold text-gray-900", children: "Sync Conflict Detected" }), _jsxs("p", { className: "text-sm text-gray-600", children: [conflict.entityType, " \u2022 ID: ", conflict.entityId.substring(0, 8), "..."] })] })] }), _jsx("button", { onClick: onCancel, className: "rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600", children: _jsx(XMarkIcon, { className: "h-6 w-6" }) })] }), _jsxs("div", { className: "mb-6 space-y-4", children: [_jsx("div", { className: "rounded-lg bg-blue-50 p-4", children: _jsx("p", { className: "text-sm text-blue-800", children: "This record was modified both locally and on the server. Please choose how to resolve the conflict." }) }), _jsxs("div", { className: "grid grid-cols-2 gap-4", children: [_jsxs("div", { className: "rounded-lg border border-gray-300 p-4", children: [_jsx("h3", { className: "mb-2 font-semibold text-gray-900", children: "Your Changes" }), _jsx("p", { className: "text-xs text-gray-600", children: new Date(conflict.localTimestamp).toLocaleString() })] }), _jsxs("div", { className: "rounded-lg border border-gray-300 p-4", children: [_jsx("h3", { className: "mb-2 font-semibold text-gray-900", children: "Server Changes" }), _jsx("p", { className: "text-xs text-gray-600", children: new Date(conflict.remoteTimestamp).toLocaleString() })] })] }), _jsxs("div", { className: "space-y-2", children: [_jsx("label", { className: "block text-sm font-medium text-gray-700", children: "Resolution Strategy" }), _jsxs("div", { className: "space-y-2", children: [_jsxs("label", { className: "flex items-center space-x-3 rounded-lg border border-gray-300 p-3 cursor-pointer hover:bg-gray-50", children: [_jsx("input", { type: "radio", name: "strategy", value: "keep-local", checked: strategy === 'keep-local', onChange: () => setStrategy('keep-local'), className: "h-4 w-4 text-primary" }), _jsxs("span", { className: "text-sm", children: [_jsx("strong", { children: "Keep Your Changes" }), " - Use all local values"] })] }), _jsxs("label", { className: "flex items-center space-x-3 rounded-lg border border-gray-300 p-3 cursor-pointer hover:bg-gray-50", children: [_jsx("input", { type: "radio", name: "strategy", value: "keep-remote", checked: strategy === 'keep-remote', onChange: () => setStrategy('keep-remote'), className: "h-4 w-4 text-primary" }), _jsxs("span", { className: "text-sm", children: [_jsx("strong", { children: "Keep Server Changes" }), " - Use all remote values"] })] }), _jsxs("label", { className: "flex items-center space-x-3 rounded-lg border border-gray-300 p-3 cursor-pointer hover:bg-gray-50", children: [_jsx("input", { type: "radio", name: "strategy", value: "manual", checked: strategy === 'manual', onChange: () => setStrategy('manual'), className: "h-4 w-4 text-primary" }), _jsxs("span", { className: "text-sm", children: [_jsx("strong", { children: "Choose Field by Field" }), " - Manually select each value"] })] })] })] }), strategy === 'manual' && (_jsxs("div", { className: "mt-4 space-y-4 rounded-lg border border-gray-300 p-4", children: [_jsx("h3", { className: "font-semibold text-gray-900", children: "Conflicting Fields" }), conflict.conflicts.map((conflictField) => (_jsxs("div", { className: "rounded-lg border border-gray-200 p-4", children: [_jsx("h4", { className: "mb-3 font-medium text-gray-900", children: conflictField.label }), _jsxs("div", { className: "grid grid-cols-2 gap-4", children: [_jsxs("button", { onClick: () => toggleFieldResolution(conflictField.field), className: `rounded-lg border-2 p-3 text-left transition-all ${manualResolution[conflictField.field] === 'local'
                                                                ? 'border-primary bg-primary/5'
                                                                : 'border-gray-200 hover:border-gray-300'}`, children: [_jsxs("div", { className: "mb-1 flex items-center justify-between", children: [_jsx("span", { className: "text-xs font-medium text-gray-600", children: "Your Value" }), manualResolution[conflictField.field] === 'local' && (_jsx("span", { className: "text-xs font-semibold text-primary", children: "\u2713 Selected" }))] }), _jsx("pre", { className: "text-sm text-gray-900 whitespace-pre-wrap", children: formatValue(conflictField.localValue, conflictField.type) })] }), _jsxs("button", { onClick: () => toggleFieldResolution(conflictField.field), className: `rounded-lg border-2 p-3 text-left transition-all ${manualResolution[conflictField.field] === 'remote'
                                                                ? 'border-primary bg-primary/5'
                                                                : 'border-gray-200 hover:border-gray-300'}`, children: [_jsxs("div", { className: "mb-1 flex items-center justify-between", children: [_jsx("span", { className: "text-xs font-medium text-gray-600", children: "Server Value" }), manualResolution[conflictField.field] === 'remote' && (_jsx("span", { className: "text-xs font-semibold text-primary", children: "\u2713 Selected" }))] }), _jsx("pre", { className: "text-sm text-gray-900 whitespace-pre-wrap", children: formatValue(conflictField.remoteValue, conflictField.type) })] })] })] }, conflictField.field)))] }))] }), _jsxs("div", { className: "flex space-x-4", children: [_jsx("button", { onClick: handleResolve, className: "btn-primary flex-1", children: "Resolve Conflict" }), _jsx("button", { onClick: onCancel, className: "btn-secondary flex-1", children: "Cancel" })] })] })] }) }));
}
