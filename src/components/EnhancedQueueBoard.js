import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// @ts-nocheck
import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db';
import { QueueListIcon, PlayIcon, CheckIcon, ClockIcon, UserGroupIcon, UserIcon, HeartIcon, DocumentTextIcon, BeakerIcon, ArrowRightIcon } from '@heroicons/react/24/outline';
const STAGES = ['registration', 'vitals', 'consult', 'pharmacy'];
export function EnhancedQueueBoard() {
    const [selectedStage, setSelectedStage] = useState('registration');
    const [stageMetrics, setStageMetrics] = useState([]);
    const [handoffLoading, setHandoffLoading] = useState(null);
    // Live query for queue items
    const queueItems = useLiveQuery(() => db.queue.orderBy('position').toArray(), [], []);
    // Live query for patients to get names
    const patients = useLiveQuery(() => db.patients.toArray(), [], []);
    const patientMap = new Map(patients.map(p => [p.id, p]));
    useEffect(() => {
        calculateStageMetrics();
    }, [queueItems]);
    const calculateStageMetrics = async () => {
        const metrics = [];
        for (const stage of STAGES) {
            const stageItems = queueItems.filter(item => item.stage === stage);
            const waiting = stageItems.filter(item => item.status === 'waiting').length;
            const inProgress = stageItems.filter(item => item.status === 'in_progress').length;
            // Simple ETA calculation (4 minutes average per patient)
            const avgTimeMinutes = 4;
            const etaMinutes = waiting * avgTimeMinutes;
            metrics.push({
                stage,
                waiting,
                inProgress,
                avgTimeMinutes,
                etaMinutes
            });
        }
        setStageMetrics(metrics);
    };
    const callNext = async (stage) => {
        try {
            const nextItem = queueItems
                .filter(item => item.stage === stage && item.status === 'waiting')
                .sort((a, b) => a.position - b.position)[0];
            if (!nextItem)
                return;
            await db.queue.update(nextItem.id, {
                status: 'in_progress',
                updatedAt: new Date()
            });
        }
        catch (error) {
            console.error('Error calling next patient:', error);
        }
    };
    const completeHandoff = async (stage, nextStage) => {
        setHandoffLoading(stage);
        try {
            const currentItem = queueItems.find(item => item.stage === stage && item.status === 'in_progress');
            if (!currentItem)
                return;
            if (nextStage) {
                // Move to next stage
                await db.queue.update(currentItem.id, {
                    stage: nextStage,
                    status: 'waiting',
                    position: await getNextPosition(nextStage),
                    updatedAt: new Date()
                });
            }
            else {
                // Complete (remove from queue)
                await db.queue.update(currentItem.id, {
                    status: 'done',
                    updatedAt: new Date()
                });
            }
        }
        catch (error) {
            console.error('Error completing handoff:', error);
        }
        finally {
            setHandoffLoading(null);
        }
    };
    const getNextPosition = async (stage) => {
        const stageItems = await db.queue.where('stage').equals(stage).toArray();
        return Math.max(0, ...stageItems.map(item => item.position)) + 1;
    };
    const getStageIcon = (stage) => {
        switch (stage) {
            case 'registration': return UserIcon;
            case 'vitals': return HeartIcon;
            case 'consult': return DocumentTextIcon;
            case 'pharmacy': return BeakerIcon;
        }
    };
    const getStageColor = (stage) => {
        switch (stage) {
            case 'registration': return 'bg-blue-50 border-blue-200 text-blue-800';
            case 'vitals': return 'bg-green-50 border-green-200 text-green-800';
            case 'consult': return 'bg-purple-50 border-purple-200 text-purple-800';
            case 'pharmacy': return 'bg-orange-50 border-orange-200 text-orange-800';
        }
    };
    const getNextStage = (stage) => {
        const stageIndex = STAGES.indexOf(stage);
        return stageIndex < STAGES.length - 1 ? STAGES[stageIndex + 1] : null;
    };
    const selectedMetrics = stageMetrics.find(m => m.stage === selectedStage);
    const currentPatient = queueItems.find(item => item.stage === selectedStage && item.status === 'in_progress');
    const waitingPatients = queueItems
        .filter(item => item.stage === selectedStage && item.status === 'waiting')
        .sort((a, b) => a.position - b.position);
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx(QueueListIcon, { className: "h-8 w-8 text-primary" }), _jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-bold text-gray-900", children: "Enhanced Queue Management" }), _jsx("p", { className: "text-gray-600", children: "Real-time patient flow with clear handoffs" })] })] }), _jsx("div", { className: "grid grid-cols-2 md:grid-cols-4 gap-4", children: stageMetrics.map((metrics) => {
                    const Icon = getStageIcon(metrics.stage);
                    const isSelected = selectedStage === metrics.stage;
                    return (_jsxs("button", { onClick: () => setSelectedStage(metrics.stage), className: `p-4 rounded-lg border-2 transition-all touch-target ${isSelected
                            ? getStageColor(metrics.stage) + ' ring-2 ring-primary/20'
                            : 'bg-white border-gray-200 hover:border-gray-300'}`, children: [_jsxs("div", { className: "flex items-center space-x-2 mb-2", children: [_jsx(Icon, { className: "h-5 w-5" }), _jsx("span", { className: "font-medium capitalize", children: metrics.stage })] }), _jsx("div", { className: "text-2xl font-bold", children: metrics.waiting + metrics.inProgress }), _jsx("div", { className: "text-sm opacity-75", children: metrics.inProgress > 0 ? `${metrics.inProgress} active` : 'Ready' }), metrics.etaMinutes > 0 && (_jsxs("div", { className: "text-xs mt-1", children: ["ETA: ", metrics.etaMinutes, "m"] }))] }, metrics.stage));
                }) }), _jsxs("div", { className: "card", children: [_jsxs("div", { className: "flex items-center justify-between mb-6", children: [_jsxs("h2", { className: "text-xl font-semibold text-gray-900 capitalize", children: [selectedStage, " Station"] }), _jsxs("div", { className: "flex items-center space-x-4 text-sm text-gray-600", children: [_jsxs("span", { children: ["Waiting: ", selectedMetrics?.waiting || 0] }), _jsxs("span", { children: ["Active: ", selectedMetrics?.inProgress || 0] }), _jsxs("span", { children: ["ETA: ", selectedMetrics?.etaMinutes || 0, "m"] })] })] }), _jsxs("div", { className: "mb-6", children: [_jsx("h3", { className: "text-lg font-medium text-gray-900 mb-3", children: "Now Serving" }), currentPatient ? (_jsx("div", { className: "bg-yellow-50 border border-yellow-200 rounded-lg p-4", children: _jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center space-x-4", children: [_jsx("div", { className: "w-12 h-12 bg-yellow-600 rounded-full flex items-center justify-center text-white font-bold", children: currentPatient.position }), _jsxs("div", { children: [_jsxs("h4", { className: "font-medium text-gray-900", children: [patientMap.get(currentPatient.patientId)?.givenName || 'Unknown', ' ', patientMap.get(currentPatient.patientId)?.familyName || 'Patient'] }), _jsxs("p", { className: "text-sm text-gray-600", children: ["Started: ", currentPatient.updatedAt.toLocaleTimeString()] })] })] }), _jsxs("div", { className: "flex space-x-2", children: [getNextStage(selectedStage) && (_jsxs("button", { onClick: () => completeHandoff(selectedStage, getNextStage(selectedStage)), disabled: handoffLoading === selectedStage, className: "btn-primary inline-flex items-center space-x-2", children: [_jsx(ArrowRightIcon, { className: "h-4 w-4" }), _jsxs("span", { children: ["Send to ", getNextStage(selectedStage)] })] })), _jsxs("button", { onClick: () => completeHandoff(selectedStage), disabled: handoffLoading === selectedStage, className: "btn-secondary inline-flex items-center space-x-2", children: [_jsx(CheckIcon, { className: "h-4 w-4" }), _jsx("span", { children: "Complete" })] })] })] }) })) : (_jsxs("div", { className: "text-center py-8 bg-gray-50 rounded-lg", children: [_jsx(ClockIcon, { className: "h-12 w-12 mx-auto text-gray-400 mb-4" }), _jsx("p", { className: "text-gray-600", children: "No patient currently being served" }), waitingPatients.length > 0 && (_jsxs("button", { onClick: () => callNext(selectedStage), className: "btn-primary mt-4 inline-flex items-center space-x-2", children: [_jsx(PlayIcon, { className: "h-5 w-5" }), _jsx("span", { children: "Call Next Patient" })] }))] }))] }), _jsxs("div", { children: [_jsxs("h3", { className: "text-lg font-medium text-gray-900 mb-3", children: ["Waiting Queue (", waitingPatients.length, ")"] }), waitingPatients.length === 0 ? (_jsxs("div", { className: "text-center py-8 text-gray-500", children: [_jsx(UserGroupIcon, { className: "h-12 w-12 mx-auto mb-4 opacity-50" }), _jsxs("p", { children: ["No patients waiting in ", selectedStage] })] })) : (_jsxs("div", { className: "space-y-2", children: [waitingPatients.slice(0, 10).map((item, index) => {
                                        const patient = patientMap.get(item.patientId);
                                        const isNext = index === 0;
                                        return (_jsxs("div", { className: `flex items-center justify-between p-3 border rounded-lg ${isNext ? 'border-green-200 bg-green-50' : 'border-gray-200'}`, children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx("div", { className: `w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm ${isNext ? 'bg-green-600' : 'bg-gray-600'}`, children: index + 1 }), _jsxs("div", { children: [_jsxs("div", { className: "font-medium text-gray-900", children: [patient?.givenName || 'Unknown', " ", patient?.familyName || 'Patient'] }), _jsxs("div", { className: "text-sm text-gray-600", children: ["Position: ", item.position, " \u2022 Added: ", item.updatedAt.toLocaleTimeString()] })] })] }), _jsx("div", { className: "text-sm text-gray-500", children: isNext ? 'Next' : `~${index * (selectedMetrics?.avgTimeMinutes || 4)}m` })] }, item.id));
                                    }), waitingPatients.length > 10 && (_jsxs("div", { className: "text-center text-sm text-gray-500 py-2", children: ["... and ", waitingPatients.length - 10, " more patients"] }))] }))] })] })] }));
}
