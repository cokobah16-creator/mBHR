import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { clinicalDecisionSupport } from '@/services/clinicalDecisionSupport';
import { db } from '@/db';
import { useAuthStore } from '@/stores/auth';
import { ExclamationTriangleIcon, CheckCircleIcon, ChartBarIcon, ClockIcon, UserGroupIcon } from '@heroicons/react/24/outline';
export function ClinicalInsightsDashboard() {
    const currentUser = useAuthStore(state => state.currentUser);
    const [alerts, setAlerts] = useState([]);
    const [highRiskPatients, setHighRiskPatients] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedTab, setSelectedTab] = useState('alerts');
    const [filterSeverity, setFilterSeverity] = useState('all');
    const [showAcknowledged, setShowAcknowledged] = useState(false);
    useEffect(() => {
        loadData();
    }, [showAcknowledged, filterSeverity]);
    const loadData = async () => {
        try {
            setLoading(true);
            const allAlerts = await db.clinicalAlerts
                .orderBy('createdAt')
                .reverse()
                .toArray();
            let filteredAlerts = showAcknowledged
                ? allAlerts
                : allAlerts.filter(a => !a.acknowledged);
            if (filterSeverity !== 'all') {
                filteredAlerts = filteredAlerts.filter(a => a.severity === filterSeverity);
            }
            setAlerts(filteredAlerts);
            const recentPatients = await db.patients
                .orderBy('updatedAt')
                .reverse()
                .limit(20)
                .toArray();
            const riskProfiles = await Promise.all(recentPatients.map(async (patient) => {
                try {
                    const profile = await clinicalDecisionSupport.assessPatientRisk(patient.id);
                    if (profile.overallRisk === 'high' || profile.overallRisk === 'critical') {
                        return {
                            patientId: patient.id,
                            name: `${patient.givenName} ${patient.familyName}`,
                            profile
                        };
                    }
                }
                catch (error) {
                    return null;
                }
                return null;
            }));
            setHighRiskPatients(riskProfiles.filter(p => p !== null));
        }
        catch (error) {
            console.error('Failed to load clinical insights:', error);
        }
        finally {
            setLoading(false);
        }
    };
    const handleAcknowledgeAlert = async (alertId) => {
        if (!currentUser)
            return;
        await clinicalDecisionSupport.acknowledgeAlert(alertId, currentUser.id);
        await loadData();
    };
    const getSeverityColor = (severity) => {
        switch (severity) {
            case 'critical': return 'text-red-600 bg-red-50 border-red-200';
            case 'high': return 'text-orange-600 bg-orange-50 border-orange-200';
            case 'moderate': return 'text-yellow-600 bg-yellow-50 border-yellow-200';
            case 'low': return 'text-blue-600 bg-blue-50 border-blue-200';
            default: return 'text-gray-600 bg-gray-50 border-gray-200';
        }
    };
    const getRiskColor = (risk) => {
        switch (risk) {
            case 'critical': return 'bg-red-500';
            case 'high': return 'bg-orange-500';
            case 'moderate': return 'bg-yellow-500';
            case 'low': return 'bg-green-500';
            default: return 'bg-gray-500';
        }
    };
    if (loading) {
        return (_jsx("div", { className: "flex items-center justify-center h-64", children: _jsx("div", { className: "animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" }) }));
    }
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "bg-white rounded-lg shadow-sm p-6", children: [_jsxs("h2", { className: "text-2xl font-bold text-gray-900 mb-4 flex items-center gap-2", children: [_jsx(ChartBarIcon, { className: "h-7 w-7 text-blue-600" }), "Clinical Decision Support"] }), _jsx("p", { className: "text-gray-600", children: "AI-powered insights to help clinicians make better decisions and identify high-risk patients" })] }), _jsxs("div", { className: "bg-white rounded-lg shadow-sm", children: [_jsx("div", { className: "border-b border-gray-200", children: _jsxs("nav", { className: "flex -mb-px", children: [_jsx("button", { onClick: () => setSelectedTab('alerts'), className: `px-6 py-3 border-b-2 font-medium text-sm ${selectedTab === 'alerts'
                                        ? 'border-blue-600 text-blue-600'
                                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`, children: _jsxs("div", { className: "flex items-center gap-2", children: [_jsx(ExclamationTriangleIcon, { className: "h-5 w-5" }), "Clinical Alerts (", alerts.length, ")"] }) }), _jsx("button", { onClick: () => setSelectedTab('risk'), className: `px-6 py-3 border-b-2 font-medium text-sm ${selectedTab === 'risk'
                                        ? 'border-blue-600 text-blue-600'
                                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`, children: _jsxs("div", { className: "flex items-center gap-2", children: [_jsx(UserGroupIcon, { className: "h-5 w-5" }), "High-Risk Patients (", highRiskPatients.length, ")"] }) }), _jsx("button", { onClick: () => setSelectedTab('adherence'), className: `px-6 py-3 border-b-2 font-medium text-sm ${selectedTab === 'adherence'
                                        ? 'border-blue-600 text-blue-600'
                                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`, children: _jsxs("div", { className: "flex items-center gap-2", children: [_jsx(ClockIcon, { className: "h-5 w-5" }), "Medication Adherence"] }) })] }) }), _jsxs("div", { className: "p-6", children: [selectedTab === 'alerts' && (_jsxs("div", { className: "space-y-4", children: [_jsx("div", { className: "flex items-center justify-between mb-4", children: _jsxs("div", { className: "flex items-center gap-4", children: [_jsxs("label", { className: "flex items-center gap-2", children: [_jsx("input", { type: "checkbox", checked: showAcknowledged, onChange: (e) => setShowAcknowledged(e.target.checked), className: "rounded border-gray-300 text-blue-600 focus:ring-blue-500" }), _jsx("span", { className: "text-sm text-gray-700", children: "Show acknowledged" })] }), _jsxs("select", { value: filterSeverity, onChange: (e) => setFilterSeverity(e.target.value), className: "rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm", children: [_jsx("option", { value: "all", children: "All Severities" }), _jsx("option", { value: "critical", children: "Critical" }), _jsx("option", { value: "high", children: "High" }), _jsx("option", { value: "moderate", children: "Moderate" }), _jsx("option", { value: "low", children: "Low" })] })] }) }), alerts.length === 0 ? (_jsxs("div", { className: "text-center py-12 text-gray-500", children: [_jsx(CheckCircleIcon, { className: "h-12 w-12 mx-auto mb-3 text-green-500" }), _jsx("p", { children: "No clinical alerts to display" })] })) : (_jsx("div", { className: "space-y-3", children: alerts.map((alert) => (_jsx("div", { className: `border rounded-lg p-4 ${getSeverityColor(alert.severity)}`, children: _jsxs("div", { className: "flex items-start justify-between", children: [_jsxs("div", { className: "flex-1", children: [_jsxs("div", { className: "flex items-center gap-2 mb-2", children: [_jsx("span", { className: `inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium uppercase ${getSeverityColor(alert.severity)}`, children: alert.severity }), _jsx("span", { className: "text-xs text-gray-500", children: alert.alertType.replace('_', ' ') })] }), _jsx("h4", { className: "font-semibold text-gray-900 mb-1", children: alert.message }), _jsx("p", { className: "text-sm text-gray-700 mb-2", children: alert.details }), _jsxs("div", { className: "text-xs text-gray-500", children: [new Date(alert.createdAt).toLocaleString(), alert.acknowledged && (_jsxs("span", { className: "ml-2 text-green-600", children: ["\u2713 Acknowledged by ", alert.acknowledgedBy] }))] })] }), !alert.acknowledged && (_jsx("button", { onClick: () => handleAcknowledgeAlert(alert.id), className: "ml-4 px-3 py-1 text-sm bg-white border border-gray-300 rounded-md hover:bg-gray-50", children: "Acknowledge" }))] }) }, alert.id))) }))] })), selectedTab === 'risk' && (_jsx("div", { className: "space-y-4", children: highRiskPatients.length === 0 ? (_jsxs("div", { className: "text-center py-12 text-gray-500", children: [_jsx(CheckCircleIcon, { className: "h-12 w-12 mx-auto mb-3 text-green-500" }), _jsx("p", { children: "No high-risk patients identified" })] })) : (_jsx("div", { className: "space-y-4", children: highRiskPatients.map(({ patientId, name, profile }) => (_jsxs("div", { className: "border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow", children: [_jsxs("div", { className: "flex items-start justify-between mb-3", children: [_jsxs("div", { children: [_jsx("h4", { className: "font-semibold text-gray-900", children: name }), _jsxs("div", { className: "flex items-center gap-2 mt-1", children: [_jsx("span", { className: `h-2 w-2 rounded-full ${getRiskColor(profile.overallRisk)}` }), _jsxs("span", { className: "text-sm text-gray-600 capitalize", children: [profile.overallRisk, " Risk"] })] })] }), _jsx("a", { href: `/patients/${patientId}`, className: "text-sm text-blue-600 hover:text-blue-800", children: "View Patient \u2192" })] }), _jsxs("div", { className: "space-y-2", children: [_jsxs("div", { children: [_jsx("h5", { className: "text-sm font-medium text-gray-700 mb-1", children: "Risk Factors:" }), _jsx("div", { className: "space-y-1", children: profile.riskFactors.map((rf, idx) => (_jsxs("div", { className: "text-sm text-gray-600 flex items-start gap-2", children: [_jsx("span", { className: `mt-1 h-1.5 w-1.5 rounded-full flex-shrink-0 ${rf.severity === 'high' ? 'bg-red-500' :
                                                                                rf.severity === 'moderate' ? 'bg-yellow-500' :
                                                                                    'bg-blue-500'}` }), _jsxs("span", { children: [_jsxs("strong", { children: [rf.factor, ":"] }), " ", rf.description] })] }, idx))) })] }), profile.predictedComplications.length > 0 && (_jsxs("div", { children: [_jsx("h5", { className: "text-sm font-medium text-gray-700 mb-1", children: "Predicted Complications:" }), _jsx("div", { className: "flex flex-wrap gap-2", children: profile.predictedComplications.map((comp, idx) => (_jsx("span", { className: "inline-flex items-center px-2 py-1 rounded-md text-xs bg-red-50 text-red-700 border border-red-200", children: comp }, idx))) })] })), profile.recommendedActions.length > 0 && (_jsxs("div", { children: [_jsx("h5", { className: "text-sm font-medium text-gray-700 mb-1", children: "Recommended Actions:" }), _jsx("ul", { className: "list-disc list-inside space-y-1", children: profile.recommendedActions.map((action, idx) => (_jsx("li", { className: "text-sm text-gray-600", children: action }, idx))) })] }))] })] }, patientId))) })) })), selectedTab === 'adherence' && (_jsxs("div", { className: "text-center py-12 text-gray-500", children: [_jsx(ClockIcon, { className: "h-12 w-12 mx-auto mb-3" }), _jsx("p", { className: "mb-2", children: "Medication Adherence Predictions" }), _jsx("p", { className: "text-sm", children: "This feature analyzes patient factors to predict medication adherence risks." }), _jsx("p", { className: "text-sm text-gray-400 mt-2", children: "Integration with prescription data coming soon" })] }))] })] }), _jsx("div", { className: "bg-blue-50 border border-blue-200 rounded-lg p-4", children: _jsxs("div", { className: "flex items-start gap-3", children: [_jsx(ExclamationTriangleIcon, { className: "h-5 w-5 text-blue-600 mt-0.5" }), _jsxs("div", { className: "text-sm text-blue-900", children: [_jsx("p", { className: "font-medium mb-1", children: "About Clinical Decision Support" }), _jsx("p", { className: "text-blue-800", children: "This AI-powered system analyzes patient vitals, medical history, and risk factors to provide intelligent alerts and recommendations. It helps identify high-risk patients early and suggests evidence-based interventions." })] })] }) })] }));
}
