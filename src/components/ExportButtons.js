import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { db } from '@/db';
import { exportTable } from '@/utils/export';
import { useAuthStore } from '@/stores/auth';
import { can } from '@/auth/roles';
import { ArrowDownTrayIcon } from '@heroicons/react/24/outline';
export function ExportButtons() {
    const { currentUser } = useAuthStore();
    // Only admins can export data
    if (!currentUser || !can(currentUser.role, 'export'))
        return null;
    const exports = [
        { table: db.patients, filename: 'patients.csv', label: 'Patients' },
        { table: db.vitals, filename: 'vitals.csv', label: 'Vitals' },
        { table: db.consultations, filename: 'consultations.csv', label: 'Consultations' },
        { table: db.dispenses, filename: 'dispenses.csv', label: 'Dispenses' },
        { table: db.inventory, filename: 'inventory.csv', label: 'Inventory' },
        { table: db.auditLogs, filename: 'audit_logs.csv', label: 'Audit Logs' }
    ];
    return (_jsxs("div", { className: "card", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-4", children: "Data Export" }), _jsx("div", { className: "grid grid-cols-2 md:grid-cols-3 gap-3", children: exports.map(({ table, filename, label }) => (_jsxs("button", { onClick: () => exportTable(table, filename, 'csv'), className: "flex items-center space-x-2 px-3 py-2 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors text-sm", children: [_jsx(ArrowDownTrayIcon, { className: "h-4 w-4" }), _jsx("span", { children: label })] }, filename))) }), _jsx("div", { className: "mt-4 pt-4 border-t border-gray-200", children: _jsxs("button", { onClick: () => exportTable(db.patients, 'all_data.json', 'json'), className: "flex items-center space-x-2 px-4 py-2 bg-green-50 text-green-700 rounded-lg hover:bg-green-100 transition-colors text-sm font-medium", children: [_jsx(ArrowDownTrayIcon, { className: "h-4 w-4" }), _jsx("span", { children: "Export All Data (JSON)" })] }) })] }));
}
