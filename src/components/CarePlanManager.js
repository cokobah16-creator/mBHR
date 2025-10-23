import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { useT } from '@/hooks/useT';
import { db, generateId } from '@/db';
import { getMessageService } from '@/services/messaging';
import { ClipboardDocumentListIcon, PlusIcon, CheckCircleIcon, ClockIcon, ExclamationTriangleIcon, CalendarIcon } from '@heroicons/react/24/outline';
export function CarePlanManager({ patientId, className = '' }) {
    const { t } = useT();
    const [tasks, setTasks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showAddTask, setShowAddTask] = useState(false);
    const [newTask, setNewTask] = useState({
        type: 'medication_reminder',
        title: '',
        description: '',
        dueDate: new Date().toISOString().split('T')[0]
    });
    useEffect(() => {
        loadCareTasks();
    }, [patientId]);
    const loadCareTasks = async () => {
        try {
            const careTasks = await db.careTasks
                .where('patientId')
                .equals(patientId)
                .reverse()
                .toArray();
            // Update overdue status
            const now = new Date();
            const updatedTasks = careTasks.map(task => {
                if (task.status === 'pending' && task.dueDate < now) {
                    return { ...task, status: 'overdue' };
                }
                return task;
            });
            setTasks(updatedTasks);
        }
        catch (error) {
            console.error('Error loading care tasks:', error);
        }
        finally {
            setLoading(false);
        }
    };
    const addTask = async () => {
        if (!newTask.title.trim())
            return;
        try {
            const task = {
                id: generateId(),
                patientId,
                type: newTask.type,
                title: newTask.title,
                description: newTask.description,
                status: 'pending',
                dueDate: new Date(newTask.dueDate),
                createdAt: new Date(),
                _dirty: 1
            };
            await db.careTasks.add(task);
            // Queue reminder if it's a medication reminder
            if (task.type === 'medication_reminder') {
                try {
                    const messageService = getMessageService();
                    await messageService.queueMedicationReminder(patientId, task.title, '1 dose', task.description, task.dueDate);
                }
                catch (error) {
                    console.warn('Failed to queue reminder:', error);
                }
            }
            await loadCareTasks();
            setShowAddTask(false);
            setNewTask({
                type: 'medication_reminder',
                title: '',
                description: '',
                dueDate: new Date().toISOString().split('T')[0]
            });
        }
        catch (error) {
            console.error('Error adding care task:', error);
        }
    };
    const completeTask = async (taskId) => {
        try {
            await db.careTasks.update(taskId, {
                status: 'completed',
                completedAt: new Date(),
                _dirty: 1
            });
            await loadCareTasks();
        }
        catch (error) {
            console.error('Error completing task:', error);
        }
    };
    const getTaskIcon = (type) => {
        switch (type) {
            case 'medication_reminder':
                return BeakerIcon;
            case 'followup_visit':
                return CalendarIcon;
            case 'vital_check':
                return HeartIcon;
            case 'lab_test':
                return ClipboardDocumentListIcon;
            default:
                return ClockIcon;
        }
    };
    const getTaskColor = (status) => {
        switch (status) {
            case 'pending':
                return 'bg-blue-100 text-blue-800 border-blue-200';
            case 'completed':
                return 'bg-green-100 text-green-800 border-green-200';
            case 'overdue':
                return 'bg-red-100 text-red-800 border-red-200';
            case 'cancelled':
                return 'bg-gray-100 text-gray-800 border-gray-200';
            default:
                return 'bg-gray-100 text-gray-800 border-gray-200';
        }
    };
    const getStatusIcon = (status) => {
        switch (status) {
            case 'pending':
                return ClockIcon;
            case 'completed':
                return CheckCircleIcon;
            case 'overdue':
                return ExclamationTriangleIcon;
            case 'cancelled':
                return ExclamationTriangleIcon;
            default:
                return ClockIcon;
        }
    };
    if (loading) {
        return (_jsx("div", { className: `space-y-4 ${className}`, children: _jsx("div", { className: "animate-pulse space-y-4", children: [...Array(3)].map((_, i) => (_jsx("div", { className: "h-20 bg-gray-200 rounded-lg" }, i))) }) }));
    }
    return (_jsxs("div", { className: `space-y-6 ${className}`, children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx(ClipboardDocumentListIcon, { className: "h-6 w-6 text-primary" }), _jsx("h3", { className: "text-lg font-semibold text-gray-900", children: t('careplan.title') })] }), _jsxs("button", { onClick: () => setShowAddTask(true), className: "btn-primary inline-flex items-center space-x-2", children: [_jsx(PlusIcon, { className: "h-4 w-4" }), _jsx("span", { children: t('careplan.addTask') })] })] }), showAddTask && (_jsxs("div", { className: "card bg-blue-50 border-blue-200", children: [_jsx("h4", { className: "text-lg font-medium text-gray-900 mb-4", children: t('careplan.newTask') }), _jsxs("div", { className: "space-y-4", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: t('careplan.taskType') }), _jsxs("select", { value: newTask.type, onChange: (e) => setNewTask(prev => ({ ...prev, type: e.target.value })), className: "input-field", children: [_jsx("option", { value: "medication_reminder", children: t('careplan.medicationReminder') }), _jsx("option", { value: "followup_visit", children: t('careplan.followupVisit') }), _jsx("option", { value: "vital_check", children: t('careplan.vitalCheck') }), _jsx("option", { value: "lab_test", children: t('careplan.labTest') })] })] }), _jsxs("div", { children: [_jsxs("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: [t('careplan.taskTitle'), " *"] }), _jsx("input", { type: "text", value: newTask.title, onChange: (e) => setNewTask(prev => ({ ...prev, title: e.target.value })), className: "input-field", placeholder: t('careplan.titlePlaceholder') })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: t('careplan.description') }), _jsx("textarea", { value: newTask.description, onChange: (e) => setNewTask(prev => ({ ...prev, description: e.target.value })), className: "input-field", rows: 3, placeholder: t('careplan.descriptionPlaceholder') })] }), _jsxs("div", { children: [_jsxs("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: [t('careplan.dueDate'), " *"] }), _jsx("input", { type: "date", value: newTask.dueDate, onChange: (e) => setNewTask(prev => ({ ...prev, dueDate: e.target.value })), className: "input-field", min: new Date().toISOString().split('T')[0] })] }), _jsxs("div", { className: "flex space-x-4", children: [_jsx("button", { onClick: addTask, className: "btn-primary", children: t('careplan.addTask') }), _jsx("button", { onClick: () => setShowAddTask(false), className: "btn-secondary", children: t('action.cancel') })] })] })] })), _jsx("div", { className: "space-y-4", children: tasks.length === 0 ? (_jsxs("div", { className: "text-center py-8 text-gray-500", children: [_jsx(ClipboardDocumentListIcon, { className: "h-12 w-12 mx-auto mb-4 opacity-50" }), _jsx("p", { children: t('careplan.noTasks') })] })) : (tasks.map((task) => {
                    const TaskIcon = getTaskIcon(task.type);
                    const StatusIcon = getStatusIcon(task.status);
                    const taskColor = getTaskColor(task.status);
                    return (_jsx("div", { className: `border rounded-lg p-4 ${taskColor}`, children: _jsxs("div", { className: "flex items-start justify-between", children: [_jsxs("div", { className: "flex items-start space-x-3", children: [_jsx(TaskIcon, { className: "h-6 w-6 mt-1" }), _jsxs("div", { children: [_jsx("h4", { className: "font-medium text-gray-900", children: task.title }), _jsx("p", { className: "text-sm text-gray-700 mt-1", children: task.description }), _jsxs("div", { className: "flex items-center space-x-4 mt-2 text-sm text-gray-600", children: [_jsx("span", { children: t(`careplan.type.${task.type}`) }), _jsxs("span", { children: ["Due: ", task.dueDate.toLocaleDateString()] }), task.completedAt && (_jsxs("span", { children: ["Completed: ", task.completedAt.toLocaleDateString()] }))] })] })] }), _jsxs("div", { className: "flex items-center space-x-2", children: [_jsxs("span", { className: `inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${taskColor}`, children: [_jsx(StatusIcon, { className: "h-3 w-3 mr-1" }), t(`careplan.status.${task.status}`)] }), task.status === 'pending' && (_jsx("button", { onClick: () => completeTask(task.id), className: "bg-green-100 text-green-800 px-3 py-1 rounded-lg hover:bg-green-200 transition-colors text-sm", children: t('action.complete') }))] })] }) }, task.id));
                })) })] }));
}
