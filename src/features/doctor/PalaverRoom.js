import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '@/stores/auth';
import { palaverRoom } from '@/services/palaverRoom';
import { db } from '@/db';
import { ChatBubbleLeftRightIcon, PaperAirplaneIcon, InboxIcon, MegaphoneIcon, CheckCircleIcon, ExclamationTriangleIcon, FireIcon, XMarkIcon, ArrowLeftIcon, UserCircleIcon, ClockIcon } from '@heroicons/react/24/outline';
export function PalaverRoom({ onClose, isPanel = false }) {
    const { currentUser } = useAuthStore();
    const [viewMode, setViewMode] = useState('inbox');
    const [messages, setMessages] = useState([]);
    const [broadcasts, setBroadcasts] = useState([]);
    const [doctors, setDoctors] = useState([]);
    const [loading, setLoading] = useState(true);
    const [unreadCount, setUnreadCount] = useState(0);
    const [selectedMessage, setSelectedMessage] = useState(null);
    const [conversationMessages, setConversationMessages] = useState([]);
    const [composeData, setComposeData] = useState({
        recipientId: '',
        recipientName: '',
        subject: '',
        body: '',
        priority: 'normal'
    });
    const [broadcastData, setBroadcastData] = useState({
        targetRole: 'all_clinical',
        subject: '',
        body: '',
        priority: 'normal'
    });
    const [sending, setSending] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [loadError, setLoadError] = useState('');
    const loadData = useCallback(async () => {
        if (!currentUser)
            return;
        setLoading(true);
        setLoadError('');
        if (!palaverRoom.isAvailable()) {
            setLoadError('Messaging service is not configured. Please check your database connection.');
            setLoading(false);
            return;
        }
        try {
            const [inbox, unread, broadcastList, staffList] = await Promise.all([
                palaverRoom.getInboxMessages(currentUser.id),
                palaverRoom.getUnreadCount(currentUser.id),
                palaverRoom.getBroadcasts(currentUser.role),
                db.users.where('role').anyOf(['doctor', 'nurse', 'admin']).and(u => u.isActive === 1).toArray()
            ]);
            setMessages(inbox);
            setUnreadCount(unread);
            setBroadcasts(broadcastList);
            setDoctors(staffList.filter(u => u.id !== currentUser.id));
        }
        catch (err) {
            console.error('Failed to load Palaver Room data:', err);
            setLoadError(err instanceof Error ? err.message : 'Failed to load messages. Please try again.');
        }
        finally {
            setLoading(false);
        }
    }, [currentUser]);
    useEffect(() => {
        loadData();
        const interval = setInterval(loadData, 30000);
        return () => clearInterval(interval);
    }, [loadData]);
    const handleSendMessage = async () => {
        if (!currentUser || !composeData.recipientId || !composeData.subject || !composeData.body) {
            setError('Please fill in all required fields');
            return;
        }
        setSending(true);
        setError('');
        try {
            await palaverRoom.sendMessage({
                senderId: currentUser.id,
                senderName: currentUser.fullName,
                recipientId: composeData.recipientId,
                recipientName: composeData.recipientName,
                subject: composeData.subject,
                body: composeData.body,
                priority: composeData.priority
            });
            setSuccess('Message sent successfully!');
            setComposeData({ recipientId: '', recipientName: '', subject: '', body: '', priority: 'normal' });
            setTimeout(() => {
                setSuccess('');
                setViewMode('inbox');
                loadData();
            }, 2000);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to send message');
        }
        finally {
            setSending(false);
        }
    };
    const handleSendBroadcast = async () => {
        if (!currentUser || !broadcastData.subject || !broadcastData.body) {
            setError('Please fill in all required fields');
            return;
        }
        setSending(true);
        setError('');
        try {
            await palaverRoom.sendBroadcast({
                senderId: currentUser.id,
                senderName: currentUser.fullName,
                targetRole: broadcastData.targetRole,
                subject: broadcastData.subject,
                body: broadcastData.body,
                priority: broadcastData.priority
            });
            setSuccess('Broadcast sent successfully!');
            setBroadcastData({ targetRole: 'all_clinical', subject: '', body: '', priority: 'normal' });
            setTimeout(() => {
                setSuccess('');
                setViewMode('inbox');
                loadData();
            }, 2000);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to send broadcast');
        }
        finally {
            setSending(false);
        }
    };
    const handleOpenMessage = async (message) => {
        if (!currentUser)
            return;
        setSelectedMessage(message);
        try {
            if (!message.is_read) {
                await palaverRoom.markAsRead(message.id);
                loadData();
            }
            const otherUserId = message.sender_id === currentUser.id ? message.recipient_id : message.sender_id;
            const conversation = await palaverRoom.getConversation(currentUser.id, otherUserId);
            setConversationMessages(conversation);
            setViewMode('conversation');
        }
        catch (err) {
            console.error('Failed to open message:', err);
            setError('Failed to load conversation. Please try again.');
        }
    };
    const handleReply = () => {
        if (!selectedMessage || !currentUser)
            return;
        const otherPerson = selectedMessage.sender_id === currentUser.id
            ? { id: selectedMessage.recipient_id, name: selectedMessage.recipient_name }
            : { id: selectedMessage.sender_id, name: selectedMessage.sender_name };
        setComposeData({
            recipientId: otherPerson.id,
            recipientName: otherPerson.name,
            subject: selectedMessage.subject.startsWith('Re:') ? selectedMessage.subject : `Re: ${selectedMessage.subject}`,
            body: '',
            priority: 'normal'
        });
        setViewMode('compose');
    };
    const formatTime = (dateStr) => {
        const date = new Date(dateStr);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);
        if (diffMins < 1)
            return 'Just now';
        if (diffMins < 60)
            return `${diffMins}m ago`;
        if (diffHours < 24)
            return `${diffHours}h ago`;
        if (diffDays < 7)
            return `${diffDays}d ago`;
        return date.toLocaleDateString();
    };
    const getPriorityIcon = (priority) => {
        switch (priority) {
            case 'critical': return _jsx(FireIcon, { className: "h-4 w-4 text-red-600" });
            case 'urgent': return _jsx(ExclamationTriangleIcon, { className: "h-4 w-4 text-orange-500" });
            default: return null;
        }
    };
    const getPriorityBadge = (priority) => {
        switch (priority) {
            case 'critical': return _jsx("span", { className: "px-2 py-0.5 bg-red-100 text-red-800 text-xs rounded-full", children: "Critical" });
            case 'urgent': return _jsx("span", { className: "px-2 py-0.5 bg-orange-100 text-orange-800 text-xs rounded-full", children: "Urgent" });
            default: return null;
        }
    };
    const containerClass = isPanel
        ? "bg-white rounded-lg shadow-lg overflow-hidden h-full flex flex-col"
        : "bg-white rounded-lg shadow-lg overflow-hidden max-w-4xl mx-auto";
    return (_jsxs("div", { className: containerClass, children: [_jsx("div", { className: "bg-gradient-to-r from-emerald-600 to-teal-600 text-white p-4", children: _jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center gap-3", children: [viewMode !== 'inbox' && (_jsx("button", { onClick: () => setViewMode('inbox'), className: "p-1 hover:bg-white/20 rounded-lg transition-colors", children: _jsx(ArrowLeftIcon, { className: "h-5 w-5" }) })), _jsx(ChatBubbleLeftRightIcon, { className: "h-8 w-8" }), _jsxs("div", { children: [_jsx("h2", { className: "text-xl font-bold", children: "Palaver Room" }), _jsx("p", { className: "text-sm text-emerald-100", children: "Staff Messaging" })] })] }), _jsxs("div", { className: "flex items-center gap-2", children: [unreadCount > 0 && (_jsxs("span", { className: "px-2 py-1 bg-red-500 text-white text-sm font-bold rounded-full", children: [unreadCount, " new"] })), onClose && (_jsx("button", { onClick: onClose, className: "p-2 hover:bg-white/20 rounded-lg transition-colors", children: _jsx(XMarkIcon, { className: "h-5 w-5" }) }))] })] }) }), viewMode === 'inbox' && (_jsxs("div", { className: "flex border-b", children: [_jsxs("button", { onClick: () => setViewMode('inbox'), className: "flex-1 px-4 py-3 text-sm font-medium text-emerald-700 border-b-2 border-emerald-600 flex items-center justify-center gap-2", children: [_jsx(InboxIcon, { className: "h-4 w-4" }), "Inbox", unreadCount > 0 && (_jsx("span", { className: "px-1.5 py-0.5 bg-red-500 text-white text-xs rounded-full", children: unreadCount }))] }), _jsxs("button", { onClick: () => setViewMode('compose'), className: "flex-1 px-4 py-3 text-sm font-medium text-gray-600 hover:text-gray-900 flex items-center justify-center gap-2", children: [_jsx(PaperAirplaneIcon, { className: "h-4 w-4" }), "Compose"] }), _jsxs("button", { onClick: () => setViewMode('broadcast'), className: "flex-1 px-4 py-3 text-sm font-medium text-gray-600 hover:text-gray-900 flex items-center justify-center gap-2", children: [_jsx(MegaphoneIcon, { className: "h-4 w-4" }), "Broadcast"] })] })), error && (_jsx("div", { className: "mx-4 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm", children: error })), success && (_jsxs("div", { className: "mx-4 mt-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm flex items-center gap-2", children: [_jsx(CheckCircleIcon, { className: "h-5 w-5" }), success] })), _jsx("div", { className: "flex-1 overflow-y-auto p-4", children: loadError ? (_jsxs("div", { className: "flex flex-col items-center justify-center py-12", children: [_jsx(ExclamationTriangleIcon, { className: "h-12 w-12 text-orange-500 mb-4" }), _jsx("p", { className: "text-gray-700 text-center mb-4", children: loadError }), _jsx("button", { onClick: loadData, className: "px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors", children: "Try Again" })] })) : loading ? (_jsx("div", { className: "flex items-center justify-center py-12", children: _jsx("div", { className: "animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" }) })) : (_jsxs(_Fragment, { children: [viewMode === 'inbox' && (_jsxs("div", { className: "space-y-4", children: [broadcasts.length > 0 && (_jsxs("div", { className: "mb-6", children: [_jsxs("h3", { className: "text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2", children: [_jsx(MegaphoneIcon, { className: "h-4 w-4" }), "Announcements"] }), _jsx("div", { className: "space-y-2", children: broadcasts.slice(0, 3).map(broadcast => (_jsx("div", { className: "p-3 bg-amber-50 border border-amber-200 rounded-lg", children: _jsx("div", { className: "flex items-start justify-between", children: _jsxs("div", { className: "flex-1", children: [_jsxs("div", { className: "flex items-center gap-2 mb-1", children: [getPriorityIcon(broadcast.priority), _jsx("span", { className: "font-medium text-gray-900", children: broadcast.subject }), getPriorityBadge(broadcast.priority)] }), _jsx("p", { className: "text-sm text-gray-700 line-clamp-2", children: broadcast.body }), _jsxs("p", { className: "text-xs text-gray-500 mt-1", children: ["From ", broadcast.sender_name, " - ", formatTime(broadcast.created_at)] })] }) }) }, broadcast.id))) })] })), _jsxs("h3", { className: "text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2", children: [_jsx(InboxIcon, { className: "h-4 w-4" }), "Messages"] }), messages.length === 0 ? (_jsxs("div", { className: "text-center py-8 text-gray-500", children: [_jsx(InboxIcon, { className: "h-12 w-12 mx-auto mb-3 text-gray-300" }), _jsx("p", { children: "No messages yet" }), _jsx("p", { className: "text-sm", children: "Messages from colleagues will appear here" })] })) : (_jsx("div", { className: "space-y-2", children: messages.map(message => (_jsx("button", { onClick: () => handleOpenMessage(message), className: `w-full text-left p-3 rounded-lg border transition-colors ${message.is_read
                                            ? 'bg-white border-gray-200 hover:bg-gray-50'
                                            : 'bg-emerald-50 border-emerald-200 hover:bg-emerald-100'}`, children: _jsxs("div", { className: "flex items-start gap-3", children: [_jsx(UserCircleIcon, { className: "h-10 w-10 text-gray-400 flex-shrink-0" }), _jsxs("div", { className: "flex-1 min-w-0", children: [_jsxs("div", { className: "flex items-center justify-between mb-1", children: [_jsx("span", { className: `font-medium ${!message.is_read ? 'text-gray-900' : 'text-gray-700'}`, children: message.sender_name }), _jsxs("div", { className: "flex items-center gap-2", children: [getPriorityIcon(message.priority), _jsx("span", { className: "text-xs text-gray-500", children: formatTime(message.created_at) })] })] }), _jsx("p", { className: `text-sm ${!message.is_read ? 'font-medium text-gray-900' : 'text-gray-700'}`, children: message.subject }), _jsx("p", { className: "text-sm text-gray-500 truncate", children: message.body })] }), !message.is_read && (_jsx("div", { className: "w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0 mt-2" }))] }) }, message.id))) }))] })), viewMode === 'compose' && (_jsxs("div", { className: "space-y-4", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900", children: "New Message" }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "To *" }), _jsxs("select", { value: composeData.recipientId, onChange: (e) => {
                                                const doctor = doctors.find(d => d.id === e.target.value);
                                                setComposeData({
                                                    ...composeData,
                                                    recipientId: e.target.value,
                                                    recipientName: doctor?.fullName || ''
                                                });
                                            }, className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500", children: [_jsx("option", { value: "", children: "Select recipient..." }), doctors.map(doctor => (_jsxs("option", { value: doctor.id, children: [doctor.fullName, " (", doctor.role, ")"] }, doctor.id)))] })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Subject *" }), _jsx("input", { type: "text", value: composeData.subject, onChange: (e) => setComposeData({ ...composeData, subject: e.target.value }), placeholder: "Message subject", className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Priority" }), _jsxs("select", { value: composeData.priority, onChange: (e) => setComposeData({ ...composeData, priority: e.target.value }), className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500", children: [_jsx("option", { value: "normal", children: "Normal" }), _jsx("option", { value: "urgent", children: "Urgent" }), _jsx("option", { value: "critical", children: "Critical" })] })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Message *" }), _jsx("textarea", { value: composeData.body, onChange: (e) => setComposeData({ ...composeData, body: e.target.value }), placeholder: "Type your message...", rows: 6, className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none" })] }), _jsxs("div", { className: "flex gap-3", children: [_jsx("button", { onClick: handleSendMessage, disabled: sending, className: "flex-1 py-2 px-4 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:bg-gray-400 transition-colors flex items-center justify-center gap-2", children: sending ? (_jsx("div", { className: "animate-spin rounded-full h-4 w-4 border-b-2 border-white" })) : (_jsxs(_Fragment, { children: [_jsx(PaperAirplaneIcon, { className: "h-4 w-4" }), "Send Message"] })) }), _jsx("button", { onClick: () => setViewMode('inbox'), className: "px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors", children: "Cancel" })] })] })), viewMode === 'broadcast' && (_jsxs("div", { className: "space-y-4", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900", children: "Send Announcement" }), _jsx("p", { className: "text-sm text-gray-600", children: "Send a message to all staff in a specific role" }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Send To *" }), _jsxs("select", { value: broadcastData.targetRole, onChange: (e) => setBroadcastData({ ...broadcastData, targetRole: e.target.value }), className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500", children: [_jsx("option", { value: "all_clinical", children: "All Clinical Staff" }), _jsx("option", { value: "doctor", children: "Doctors Only" }), _jsx("option", { value: "nurse", children: "Nurses Only" }), _jsx("option", { value: "pharmacist", children: "Pharmacists Only" }), _jsx("option", { value: "all_staff", children: "All Staff" })] })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Subject *" }), _jsx("input", { type: "text", value: broadcastData.subject, onChange: (e) => setBroadcastData({ ...broadcastData, subject: e.target.value }), placeholder: "Announcement subject", className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Priority" }), _jsxs("select", { value: broadcastData.priority, onChange: (e) => setBroadcastData({ ...broadcastData, priority: e.target.value }), className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500", children: [_jsx("option", { value: "normal", children: "Normal" }), _jsx("option", { value: "urgent", children: "Urgent" }), _jsx("option", { value: "critical", children: "Critical" })] })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Message *" }), _jsx("textarea", { value: broadcastData.body, onChange: (e) => setBroadcastData({ ...broadcastData, body: e.target.value }), placeholder: "Type your announcement...", rows: 6, className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none" })] }), _jsxs("div", { className: "flex gap-3", children: [_jsx("button", { onClick: handleSendBroadcast, disabled: sending, className: "flex-1 py-2 px-4 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:bg-gray-400 transition-colors flex items-center justify-center gap-2", children: sending ? (_jsx("div", { className: "animate-spin rounded-full h-4 w-4 border-b-2 border-white" })) : (_jsxs(_Fragment, { children: [_jsx(MegaphoneIcon, { className: "h-4 w-4" }), "Send Broadcast"] })) }), _jsx("button", { onClick: () => setViewMode('inbox'), className: "px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors", children: "Cancel" })] })] })), viewMode === 'conversation' && selectedMessage && (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900", children: selectedMessage.subject }), _jsx("button", { onClick: handleReply, className: "px-3 py-1.5 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 transition-colors", children: "Reply" })] }), _jsx("div", { className: "space-y-3", children: conversationMessages.map(msg => (_jsxs("div", { className: `p-4 rounded-lg ${msg.sender_id === currentUser?.id
                                            ? 'bg-emerald-50 border border-emerald-200 ml-8'
                                            : 'bg-gray-50 border border-gray-200 mr-8'}`, children: [_jsxs("div", { className: "flex items-center justify-between mb-2", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(UserCircleIcon, { className: "h-6 w-6 text-gray-400" }), _jsx("span", { className: "font-medium text-gray-900", children: msg.sender_name }), getPriorityBadge(msg.priority)] }), _jsxs("div", { className: "flex items-center gap-1 text-xs text-gray-500", children: [_jsx(ClockIcon, { className: "h-3 w-3" }), formatTime(msg.created_at)] })] }), _jsx("p", { className: "text-gray-700 whitespace-pre-wrap", children: msg.body })] }, msg.id))) })] }))] })) })] }));
}
export default PalaverRoom;
