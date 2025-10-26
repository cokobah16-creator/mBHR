import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import * as logger from '@/lib/logger';
import { formatNigerianDate } from '@/utils/dateFormat';
import { PaperAirplaneIcon, InboxIcon, UserCircleIcon } from '@heroicons/react/24/outline';
export function SecureMessaging() {
    const [messages, setMessages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [showCompose, setShowCompose] = useState(false);
    const [selectedMessage, setSelectedMessage] = useState(null);
    const [newMessage, setNewMessage] = useState({ subject: '', body: '' });
    useEffect(() => {
        loadMessages();
        // Set up real-time subscription
        const channel = supabase
            .channel('secure_messages')
            .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'patient_secure_messages'
        }, () => {
            loadMessages();
        })
            .subscribe();
        return () => {
            supabase.removeChannel(channel);
        };
    }, []);
    const loadMessages = async () => {
        setLoading(true);
        setError('');
        try {
            const portalUserStr = localStorage.getItem('patient_portal_user');
            if (!portalUserStr) {
                window.location.href = '/patient/login';
                return;
            }
            const portalUser = JSON.parse(portalUserStr);
            if (!portalUser.patientId) {
                window.location.href = '/patient/login';
                return;
            }
            const { data, error: messagesError } = await supabase
                .from('patient_secure_messages')
                .select('*')
                .eq('patient_id', portalUser.patientId)
                .order('created_at', { ascending: false });
            if (messagesError)
                throw messagesError;
            setMessages(data || []);
        }
        catch (err) {
            logger.error('Error loading messages:', err);
            setError('Failed to load messages');
        }
        finally {
            setLoading(false);
        }
    };
    const sendMessage = async () => {
        if (!newMessage.subject.trim() || !newMessage.body.trim()) {
            setError('Subject and message are required');
            return;
        }
        setSending(true);
        setError('');
        setSuccess('');
        try {
            const portalUserStr = localStorage.getItem('patient_portal_user');
            if (!portalUserStr) {
                window.location.href = '/patient/login';
                return;
            }
            const portalUser = JSON.parse(portalUserStr);
            const { data: patient } = await supabase
                .from('patients')
                .select('name')
                .eq('id', portalUser.patientId)
                .maybeSingle();
            const { error: insertError } = await supabase
                .from('patient_secure_messages')
                .insert({
                patient_id: portalUser.patientId,
                subject: newMessage.subject,
                body: newMessage.body,
                from_patient: true,
                from_name: patient?.name || 'Patient',
                read: false
            });
            if (insertError)
                throw insertError;
            setSuccess('Message sent successfully');
            setNewMessage({ subject: '', body: '' });
            setShowCompose(false);
            await loadMessages();
        }
        catch (err) {
            logger.error('Error sending message:', err);
            setError('Failed to send message');
        }
        finally {
            setSending(false);
        }
    };
    const markAsRead = async (messageId) => {
        try {
            await supabase
                .from('patient_secure_messages')
                .update({ read: true })
                .eq('id', messageId);
            await loadMessages();
        }
        catch (err) {
            logger.error('Error marking message as read:', err);
        }
    };
    const openMessage = (message) => {
        setSelectedMessage(message);
        if (!message.read && !message.from_patient) {
            markAsRead(message.id);
        }
    };
    if (loading) {
        return (_jsx("div", { className: "min-h-screen bg-gray-50 px-4 py-8", children: _jsx("div", { className: "max-w-4xl mx-auto", children: _jsxs("div", { className: "text-center", children: [_jsx("div", { className: "animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto" }), _jsx("p", { className: "mt-4 text-gray-600", children: "Loading messages..." })] }) }) }));
    }
    return (_jsx("div", { className: "min-h-screen bg-gray-50 px-4 py-8", children: _jsxs("div", { className: "max-w-4xl mx-auto", children: [_jsxs("div", { className: "mb-6 flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-bold text-gray-900", children: "Secure Messaging" }), _jsx("p", { className: "mt-2 text-gray-600", children: "Communicate securely with your healthcare providers" })] }), _jsx("button", { onClick: () => setShowCompose(true), className: "px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700", children: "New Message" })] }), error && (_jsx("div", { className: "mb-4 p-4 bg-red-50 border border-red-200 rounded-lg", children: _jsx("p", { className: "text-sm text-red-800", children: error }) })), success && (_jsx("div", { className: "mb-4 p-4 bg-green-50 border border-green-200 rounded-lg", children: _jsx("p", { className: "text-sm text-green-800", children: success }) })), showCompose && (_jsxs("div", { className: "mb-6 bg-white rounded-lg shadow-sm border border-gray-200 p-6", children: [_jsx("h2", { className: "text-lg font-semibold mb-4", children: "Compose New Message" }), _jsxs("div", { className: "space-y-4", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Subject" }), _jsx("input", { type: "text", value: newMessage.subject, onChange: (e) => setNewMessage({ ...newMessage, subject: e.target.value }), placeholder: "Enter subject", className: "w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Message" }), _jsx("textarea", { value: newMessage.body, onChange: (e) => setNewMessage({ ...newMessage, body: e.target.value }), placeholder: "Type your message here...", rows: 6, className: "w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent" })] }), _jsxs("div", { className: "flex gap-2", children: [_jsxs("button", { onClick: sendMessage, disabled: sending, className: "inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50", children: [_jsx(PaperAirplaneIcon, { className: "h-5 w-5" }), sending ? 'Sending...' : 'Send Message'] }), _jsx("button", { onClick: () => setShowCompose(false), disabled: sending, className: "px-4 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600 disabled:opacity-50", children: "Cancel" })] })] })] })), selectedMessage ? (_jsxs("div", { className: "bg-white rounded-lg shadow-sm border border-gray-200 p-6", children: [_jsx("button", { onClick: () => setSelectedMessage(null), className: "mb-4 text-blue-600 hover:text-blue-800", children: "\u2190 Back to inbox" }), _jsxs("div", { className: "border-b border-gray-200 pb-4 mb-4", children: [_jsx("h2", { className: "text-xl font-semibold text-gray-900", children: selectedMessage.subject }), _jsxs("div", { className: "mt-2 flex items-center gap-4 text-sm text-gray-600", children: [_jsxs("span", { className: "flex items-center gap-1", children: [_jsx(UserCircleIcon, { className: "h-5 w-5" }), selectedMessage.from_patient ? 'You' : selectedMessage.from_name] }), _jsx("span", { children: formatNigerianDate(selectedMessage.created_at) })] })] }), _jsx("div", { className: "prose max-w-none", children: _jsx("p", { className: "whitespace-pre-wrap text-gray-900", children: selectedMessage.body }) })] })) : (_jsx("div", { className: "bg-white rounded-lg shadow-sm border border-gray-200", children: messages.length === 0 ? (_jsxs("div", { className: "p-12 text-center", children: [_jsx(InboxIcon, { className: "h-16 w-16 text-gray-400 mx-auto mb-4" }), _jsx("h3", { className: "text-lg font-medium text-gray-900 mb-2", children: "No messages" }), _jsx("p", { className: "text-gray-600", children: "Start a conversation with your healthcare provider" })] })) : (_jsx("div", { className: "divide-y divide-gray-200", children: messages.map((message) => (_jsx("button", { onClick: () => openMessage(message), className: "w-full p-4 text-left hover:bg-gray-50 transition-colors", children: _jsxs("div", { className: "flex items-start justify-between", children: [_jsxs("div", { className: "flex-1", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("h3", { className: `font-medium ${!message.read && !message.from_patient
                                                            ? 'text-blue-600'
                                                            : 'text-gray-900'}`, children: message.subject }), !message.read && !message.from_patient && (_jsx("span", { className: "inline-block w-2 h-2 bg-blue-600 rounded-full" }))] }), _jsxs("p", { className: "text-sm text-gray-600 mt-1", children: ["From: ", message.from_patient ? 'You' : message.from_name] }), _jsx("p", { className: "text-sm text-gray-500 mt-1 line-clamp-2", children: message.body })] }), _jsx("span", { className: "text-xs text-gray-500 ml-4 whitespace-nowrap", children: formatNigerianDate(message.created_at) })] }) }, message.id))) })) }))] }) }));
}
