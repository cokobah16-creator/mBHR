import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { useQueue } from '@/stores/queue';
import { TicketIcon, UserGroupIcon } from '@heroicons/react/24/outline';
const categories = ['adult', 'child', 'antenatal'];
const priorities = ['normal', 'urgent', 'low'];
export default function TicketIssuer() {
    const { issueTicket } = useQueue();
    const [form, setForm] = useState({
        category: 'adult',
        priority: 'normal',
        patientId: '',
        stage: 'registration'
    });
    const [loading, setLoading] = useState(false);
    async function handleSubmit(e) {
        e.preventDefault();
        setLoading(true);
        try {
            const ticket = await issueTicket({
                siteId: 'demo-site',
                category: form.category,
                priority: form.priority,
                patientId: form.patientId || undefined,
                stage: form.stage
            });
            alert(`✅ Ticket issued: ${ticket.number}`);
            // Reset form
            setForm({
                category: 'adult',
                priority: 'normal',
                patientId: '',
                stage: 'registration'
            });
        }
        catch (error) {
            console.error('Error issuing ticket:', error);
            alert('❌ Failed to issue ticket');
        }
        finally {
            setLoading(false);
        }
    }
    return (_jsxs("div", { className: "p-4 space-y-6", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx(TicketIcon, { className: "h-8 w-8 text-primary" }), _jsx("h2", { className: "text-2xl font-bold text-gray-900", children: "Issue Ticket" })] }), _jsx("div", { className: "card max-w-md", children: _jsxs("form", { onSubmit: handleSubmit, className: "space-y-4", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Category" }), _jsxs("select", { value: form.category, onChange: (e) => setForm({ ...form, category: e.target.value }), className: "input-field", children: [_jsx("option", { value: "adult", children: "Adult" }), _jsx("option", { value: "child", children: "Child" }), _jsx("option", { value: "antenatal", children: "Antenatal" })] })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Priority" }), _jsxs("select", { value: form.priority, onChange: (e) => setForm({ ...form, priority: e.target.value }), className: "input-field", children: [_jsx("option", { value: "normal", children: "Normal" }), _jsx("option", { value: "urgent", children: "Urgent" }), _jsx("option", { value: "low", children: "Low" })] })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Patient ID (Optional)" }), _jsx("input", { type: "text", value: form.patientId, onChange: (e) => setForm({ ...form, patientId: e.target.value }), className: "input-field", placeholder: "Leave blank for walk-in" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Starting Stage" }), _jsxs("select", { value: form.stage, onChange: (e) => setForm({ ...form, stage: e.target.value }), className: "input-field", children: [_jsx("option", { value: "registration", children: "Registration" }), _jsx("option", { value: "vitals", children: "Vitals" }), _jsx("option", { value: "consult", children: "Consultation" }), _jsx("option", { value: "pharmacy", children: "Pharmacy" })] })] }), _jsx("button", { type: "submit", disabled: loading, className: "btn-primary w-full", children: loading ? 'Issuing...' : 'Issue Ticket' })] }) }), _jsxs("div", { className: "card bg-blue-50 border-blue-200", children: [_jsxs("div", { className: "flex items-center space-x-2 mb-2", children: [_jsx(UserGroupIcon, { className: "h-5 w-5 text-blue-600" }), _jsx("h3", { className: "font-medium text-blue-800", children: "How it works" })] }), _jsxs("div", { className: "text-sm text-blue-700 space-y-1", children: [_jsx("p", { children: "\u2022 Tickets are automatically numbered (A-001, B-001, C-001)" }), _jsx("p", { children: "\u2022 Categories: A=Adult, B=Child, C=Antenatal" }), _jsx("p", { children: "\u2022 Urgent tickets are prioritized in the queue" }), _jsx("p", { children: "\u2022 Patients can be linked to existing records" })] })] })] }));
}
