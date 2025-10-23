import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { useAuthStore } from '@/stores/auth';
import { db } from '@/db';
import { GamificationService } from '@/services/gamification';
import { can } from '@/auth/roles';
import { CheckCircleIcon, XCircleIcon, TrophyIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
export default function ApprovalInbox() {
    const { currentUser } = useAuthStore();
    const [pendingSessions, setPendingSessions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(null);
    // Only admins and leads can approve
    if (!currentUser || !can(currentUser.role, 'users')) {
        return (_jsxs("div", { className: "text-center py-12", children: [_jsx(ExclamationTriangleIcon, { className: "h-12 w-12 mx-auto text-gray-400 mb-4" }), _jsx("h3", { className: "text-lg font-medium text-gray-900 mb-2", children: "Access Restricted" }), _jsx("p", { className: "text-gray-600", children: "Only administrators can approve game sessions." })] }));
    }
    useEffect(() => {
        loadPendingSessions();
    }, []);
    const loadPendingSessions = async () => {
        try {
            const sessions = await db.gameSessions
                .where('committed')
                .equals(false)
                .and(session => !!session.finishedAt)
                .toArray();
            // Get volunteer names
            const volunteerIds = [...new Set(sessions.map(s => s.volunteerId))];
            const users = await db.users.where('id').anyOf(volunteerIds).toArray();
            const userMap = new Map(users.map(u => [u.id, u.fullName]));
            const sessionsWithNames = sessions.map(session => ({
                id: session.id,
                type: session.type,
                volunteerId: session.volunteerId,
                volunteerName: userMap.get(session.volunteerId) || 'Unknown',
                startedAt: session.startedAt,
                finishedAt: session.finishedAt,
                score: session.score,
                tokensEarned: session.tokensEarned,
                payload: JSON.parse(session.payloadJson)
            }));
            setPendingSessions(sessionsWithNames);
        }
        catch (error) {
            console.error('Error loading pending sessions:', error);
        }
        finally {
            setLoading(false);
        }
    };
    const approveSession = async (sessionId) => {
        if (!currentUser)
            return;
        setProcessing(sessionId);
        try {
            await GamificationService.approveSession(sessionId, currentUser.id);
            await loadPendingSessions(); // Refresh list
        }
        catch (error) {
            console.error('Error approving session:', error);
            alert('Failed to approve session');
        }
        finally {
            setProcessing(null);
        }
    };
    const rejectSession = async (sessionId) => {
        if (!confirm('Are you sure you want to reject this session? This cannot be undone.')) {
            return;
        }
        setProcessing(sessionId);
        try {
            await db.gameSessions.delete(sessionId);
            await loadPendingSessions(); // Refresh list
        }
        catch (error) {
            console.error('Error rejecting session:', error);
            alert('Failed to reject session');
        }
        finally {
            setProcessing(null);
        }
    };
    const bulkApproveAll = async () => {
        if (!confirm(`Approve all ${pendingSessions.length} pending sessions?`)) {
            return;
        }
        setProcessing('bulk');
        try {
            for (const session of pendingSessions) {
                await GamificationService.approveSession(session.id, currentUser.id);
            }
            await loadPendingSessions();
            alert(`✅ Approved ${pendingSessions.length} sessions successfully!`);
        }
        catch (error) {
            console.error('Error bulk approving:', error);
            alert('Failed to approve some sessions');
        }
        finally {
            setProcessing(null);
        }
    };
    const getGameTypeLabel = (type) => {
        const labels = {
            vitals: 'Vitals Precision',
            shelf: 'Shelf Sleuth',
            quiz: 'Knowledge Blitz',
            triage: 'Triage Sprint'
        };
        return labels[type] || type;
    };
    const getGameTypeColor = (type) => {
        const colors = {
            vitals: 'bg-green-100 text-green-800',
            shelf: 'bg-blue-100 text-blue-800',
            quiz: 'bg-purple-100 text-purple-800',
            triage: 'bg-orange-100 text-orange-800'
        };
        return colors[type] || 'bg-gray-100 text-gray-800';
    };
    if (loading) {
        return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx(TrophyIcon, { className: "h-8 w-8 text-primary" }), _jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-bold text-gray-900", children: "Approval Inbox" }), _jsx("p", { className: "text-gray-600", children: "Loading pending game sessions..." })] })] }), _jsx("div", { className: "flex items-center justify-center py-12", children: _jsx("div", { className: "animate-spin rounded-full h-12 w-12 border-b-2 border-primary" }) })] }));
    }
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx(TrophyIcon, { className: "h-8 w-8 text-primary" }), _jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-bold text-gray-900", children: "Approval Inbox" }), _jsx("p", { className: "text-gray-600", children: "Review and approve completed game sessions" })] })] }), pendingSessions.length > 0 && (_jsxs("button", { onClick: bulkApproveAll, disabled: processing === 'bulk', className: "btn-primary inline-flex items-center space-x-2", children: [_jsx(CheckCircleIcon, { className: "h-5 w-5" }), _jsx("span", { children: processing === 'bulk' ? 'Approving...' : `Approve All (${pendingSessions.length})` })] }))] }), _jsx("div", { className: "space-y-4", children: pendingSessions.length === 0 ? (_jsxs("div", { className: "text-center py-12", children: [_jsx(CheckCircleIcon, { className: "h-12 w-12 mx-auto text-green-500 mb-4" }), _jsx("h3", { className: "text-lg font-medium text-gray-900 mb-2", children: "All caught up!" }), _jsx("p", { className: "text-gray-600", children: "No pending game sessions to review." })] })) : (pendingSessions.map((session) => (_jsx("div", { className: "card", children: _jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center space-x-4", children: [_jsx("div", { className: "flex-shrink-0", children: _jsx("span", { className: `inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${getGameTypeColor(session.type)}`, children: getGameTypeLabel(session.type) }) }), _jsxs("div", { children: [_jsx("h3", { className: "text-lg font-medium text-gray-900", children: session.volunteerName }), _jsxs("div", { className: "flex items-center space-x-4 text-sm text-gray-600", children: [_jsxs("span", { children: ["Score: ", session.score] }), _jsxs("span", { children: ["Duration: ", Math.round((session.finishedAt.getTime() - session.startedAt.getTime()) / 60000), "m"] }), _jsxs("span", { children: ["Completed: ", session.finishedAt.toLocaleTimeString()] })] })] })] }), _jsxs("div", { className: "flex items-center space-x-4", children: [_jsxs("div", { className: "text-right", children: [_jsx("div", { className: "text-lg font-bold text-primary", children: session.tokensEarned }), _jsx("div", { className: "text-sm text-gray-600", children: "tokens" })] }), _jsxs("div", { className: "flex space-x-2", children: [_jsx("button", { onClick: () => approveSession(session.id), disabled: processing === session.id, className: "bg-green-100 text-green-800 px-3 py-2 rounded-lg hover:bg-green-200 transition-colors disabled:opacity-50", children: processing === session.id ? (_jsx("div", { className: "animate-spin rounded-full h-4 w-4 border-b-2 border-green-600" })) : (_jsx(CheckCircleIcon, { className: "h-4 w-4" })) }), _jsx("button", { onClick: () => rejectSession(session.id), disabled: processing === session.id, className: "bg-red-100 text-red-800 px-3 py-2 rounded-lg hover:bg-red-200 transition-colors disabled:opacity-50", children: _jsx(XCircleIcon, { className: "h-4 w-4" }) })] })] })] }) }, session.id)))) })] }));
}
