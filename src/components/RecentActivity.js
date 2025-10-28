import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { db } from '@/db';
import { HeartIcon, DocumentTextIcon, BeakerIcon, UserIcon } from '@heroicons/react/24/outline';
export function RecentActivity() {
    const [activities, setActivities] = useState([]);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        loadRecentActivity();
    }, []);
    const loadRecentActivity = async () => {
        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            // Get recent vitals, consultations, and dispenses
            const [vitals, consultations, dispenses] = await Promise.all([
                db.vitals.where('takenAt').above(today).reverse().limit(10).toArray(),
                db.consultations.where('createdAt').above(today).reverse().limit(10).toArray(),
                db.dispenses.where('dispensedAt').above(today).reverse().limit(10).toArray()
            ]);
            // Get patient names for each activity
            const activities = [];
            for (const vital of vitals) {
                const patient = await db.patients.get(vital.patientId);
                if (patient) {
                    activities.push({
                        id: vital.id,
                        type: 'vital',
                        patientName: `${patient.givenName} ${patient.familyName}`,
                        timestamp: vital.takenAt,
                        details: `BP: ${vital.systolic}/${vital.diastolic}, HR: ${vital.pulseBpm}`
                    });
                }
            }
            for (const consultation of consultations) {
                const patient = await db.patients.get(consultation.patientId);
                if (patient) {
                    activities.push({
                        id: consultation.id,
                        type: 'consultation',
                        patientName: `${patient.givenName} ${patient.familyName}`,
                        timestamp: consultation.createdAt,
                        details: `Provider: ${consultation.providerName}`
                    });
                }
            }
            for (const dispense of dispenses) {
                const patient = await db.patients.get(dispense.patientId);
                if (patient) {
                    activities.push({
                        id: dispense.id,
                        type: 'dispense',
                        patientName: `${patient.givenName} ${patient.familyName}`,
                        timestamp: dispense.dispensedAt,
                        details: `${dispense.itemName} x${dispense.qty}`
                    });
                }
            }
            // Sort by timestamp and take most recent 10
            activities.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
            setActivities(activities.slice(0, 10));
        }
        catch (error) {
            console.error('Error loading recent activity:', error);
        }
        finally {
            setLoading(false);
        }
    };
    const getActivityIcon = (type) => {
        switch (type) {
            case 'vital':
                return HeartIcon;
            case 'consultation':
                return DocumentTextIcon;
            case 'dispense':
                return BeakerIcon;
            default:
                return UserIcon;
        }
    };
    const getActivityColor = (type) => {
        switch (type) {
            case 'vital':
                return 'text-green-600 bg-green-50';
            case 'consultation':
                return 'text-purple-600 bg-purple-50';
            case 'dispense':
                return 'text-orange-600 bg-orange-50';
            default:
                return 'text-gray-600 bg-gray-50';
        }
    };
    const formatTime = (date) => {
        return date.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit'
        });
    };
    if (loading) {
        return (_jsx("div", { className: "space-y-3", children: [...Array(5)].map((_, i) => (_jsxs("div", { className: "flex items-center space-x-3 p-3 animate-pulse", children: [_jsx("div", { className: "w-10 h-10 bg-gray-200 rounded-full" }), _jsxs("div", { className: "flex-1", children: [_jsx("div", { className: "h-4 bg-gray-200 rounded w-32 mb-1" }), _jsx("div", { className: "h-3 bg-gray-200 rounded w-48" })] }), _jsx("div", { className: "h-3 bg-gray-200 rounded w-12" })] }, i))) }));
    }
    return (_jsx("div", { className: "space-y-3", children: activities.length === 0 ? (_jsxs("div", { className: "text-center py-8 text-gray-500", children: [_jsx(UserIcon, { className: "h-12 w-12 mx-auto mb-4 opacity-50" }), _jsx("p", { children: "No recent activity" })] })) : (activities.map((activity) => {
            const Icon = getActivityIcon(activity.type);
            const colorClass = getActivityColor(activity.type);
            return (_jsxs("div", { className: "flex items-center space-x-3 p-3 hover:bg-gray-50 rounded-lg transition-colors", children: [_jsx("div", { className: `p-2 rounded-full ${colorClass}`, children: _jsx(Icon, { className: "h-5 w-5" }) }), _jsxs("div", { className: "flex-1 min-w-0", children: [_jsx("p", { className: "text-sm font-medium text-gray-900 truncate", children: activity.patientName }), _jsx("p", { className: "text-xs text-gray-500 truncate", children: activity.details })] }), _jsx("div", { className: "text-xs text-gray-400", children: formatTime(activity.timestamp) })] }, activity.id));
        })) }));
}
