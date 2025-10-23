import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth';
import { isOnlineSyncEnabled } from '@/sync/adapter';
import { db } from '@/db';
import { derivePinHash } from '@/utils/pin';
export default function Login() {
    const [mode, setMode] = useState('offline');
    const [pin, setPin] = useState('');
    const [err, setErr] = useState(null);
    const [attempts, setAttempts] = useState(0);
    const [loading, setLoading] = useState(false);
    const [showDebug, setShowDebug] = useState(false);
    const onlineAvailable = isOnlineSyncEnabled();
    const navigate = useNavigate();
    const { login } = useAuthStore();
    // Debug panel state
    const [debugUsers, setDebugUsers] = useState([]);
    const [computed, setComputed] = useState('');
    // Reset local data function
    const resetLocal = async () => {
        try {
            setLoading(true);
            await db.delete();
            localStorage.clear();
            sessionStorage.clear();
            // Clear Zustand persisted state
            const keys = Object.keys(localStorage);
            keys.forEach(key => {
                if (key.includes('mbhr') || key.includes('auth')) {
                    localStorage.removeItem(key);
                }
            });
            alert('Local data cleared. The app will now reload and reseed.');
            window.location.reload();
        }
        catch (e) {
            console.error('Failed to reset local data:', e);
            alert('Failed to reset local data. Check console for details.');
        }
        finally {
            setLoading(false);
        }
    };
    // Load debug users
    useEffect(() => {
        if (showDebug) {
            (async () => {
                try {
                    const users = await db.users.where('isActive').equals(1).toArray();
                    setDebugUsers(users.map(u => ({
                        name: u.fullName,
                        role: u.role,
                        salt: u.pinSalt?.slice(0, 10) + '…',
                        hash: u.pinHash?.slice(0, 12) + '…'
                    })));
                }
                catch (error) {
                    console.error('Error loading debug users:', error);
                    setDebugUsers([]);
                }
            })();
        }
    }, [showDebug, attempts]);
    // Compute hash for debugging
    useEffect(() => {
        if (pin && debugUsers.length > 0) {
            (async () => {
                try {
                    const first = await db.users.where('isActive').equals(1).first();
                    if (first?.pinSalt) {
                        const h = await derivePinHash(pin, first.pinSalt);
                        setComputed(h.slice(0, 12) + '…');
                    }
                    else {
                        setComputed('');
                    }
                }
                catch (error) {
                    console.error('Error computing hash:', error);
                    setComputed('Error');
                }
            })();
        }
        else {
            setComputed('');
        }
    }, [pin, debugUsers]);
    const handleSubmit = async (e) => {
        e.preventDefault();
        console.log('[login] form submitted, mode:', mode, 'pin:', pin);
        setErr(null);
        setLoading(true);
        try {
            if (mode === 'offline') {
                console.log('[login] attempting offline PIN login');
                const success = await login(pin);
                console.log('[login] result:', success);
                if (success) {
                    console.log('[login] success - navigating to dashboard');
                    navigate('/');
                }
                else {
                    console.log('[login] failed - invalid PIN');
                    setErr('Invalid PIN');
                    setAttempts(a => a + 1);
                }
            }
            else {
                // Online mode
                if (!onlineAvailable) {
                    setErr('Online login not available');
                    return;
                }
                setErr('Online login not implemented yet');
            }
        }
        catch (ex) {
            console.error('[login] error:', ex);
            setAttempts(a => a + 1);
            setErr(ex?.message || 'Login failed');
        }
        finally {
            setLoading(false);
        }
    };
    return (_jsx("div", { className: "min-h-screen flex items-center justify-center p-6 bg-white", children: _jsxs("div", { className: "w-full max-w-md", children: [_jsxs("div", { className: "text-center mb-6", children: [_jsx("div", { className: "text-2xl font-semibold", children: "Med Bridge Health Reach" }), _jsx("div", { className: "text-sm text-gray-500", children: "Powered by Dr. Isioma Okobah Foundation" })] }), _jsxs("div", { className: "flex mb-4 gap-2", children: [_jsx("button", { type: "button", className: `flex-1 border rounded p-2 ${mode === 'offline' ? 'bg-emerald-50 border-emerald-600' : 'border-gray-300'}`, onClick: () => {
                                console.log('[login] switching to offline mode');
                                setMode('offline');
                            }, children: "Offline PIN" }), _jsx("button", { type: "button", className: `flex-1 border rounded p-2 ${mode === 'online' ? 'bg-emerald-50 border-emerald-600' : 'border-gray-300'}`, onClick: () => {
                                console.log('[login] switching to online mode');
                                setMode('online');
                            }, disabled: !onlineAvailable, title: onlineAvailable ? '' : 'Online auth not configured', children: "Online" })] }), _jsxs("form", { onSubmit: handleSubmit, className: "space-y-3", children: [mode === 'offline' && (_jsxs(_Fragment, { children: [_jsx("label", { className: "block text-sm font-medium", children: "PIN" }), _jsx("input", { "aria-label": "PIN", inputMode: "numeric", pattern: "\\d{6}", maxLength: 6, value: pin, onChange: e => {
                                        const newPin = e.target.value.replace(/\D/g, '').slice(0, 6);
                                        console.log('[login] PIN changed:', newPin);
                                        setPin(newPin);
                                    }, className: "w-full border rounded px-3 py-2", placeholder: "Enter your 6-digit PIN", required: true }), attempts > 0 && _jsxs("div", { className: "text-xs text-amber-600", children: ["Failed attempts: ", attempts, "/5"] })] })), mode === 'online' && (_jsxs("div", { className: "text-sm text-gray-600", children: ["Online login will use Supabase auth when configured. (Set ", _jsx("code", { children: "VITE_SUPABASE_URL" }), " and", _jsx("code", { children: " VITE_SUPABASE_ANON_KEY" }), ".)"] })), err && _jsx("div", { className: "text-sm text-red-600", children: err }), _jsx("button", { type: "submit", disabled: loading, className: "w-full bg-emerald-700 text-white py-2 rounded hover:bg-emerald-800 disabled:opacity-50", children: loading ? 'Logging in...' : 'Login' }), _jsxs("div", { className: "flex items-center justify-between text-sm mt-4 pt-4 border-t", children: [_jsx("button", { type: "button", onClick: resetLocal, className: "text-red-600 hover:text-red-800 underline", disabled: loading, children: "Reset local data" }), _jsxs("button", { type: "button", onClick: () => setShowDebug(s => !s), className: "text-blue-600 hover:text-blue-800 underline", children: [showDebug ? 'Hide' : 'Show', " debug"] })] })] }), showDebug && (_jsxs("div", { className: "mt-4 rounded-lg border p-3 bg-gray-50 text-sm", children: [_jsx("div", { className: "font-semibold mb-2", children: "Debug Panel (Offline Mode)" }), _jsxs("div", { className: "mb-2", children: ["Active users: ", debugUsers.length] }), debugUsers.length > 0 ? (_jsx("div", { className: "space-y-2", children: debugUsers.map((user, index) => (_jsxs("div", { className: "bg-white p-2 rounded border text-xs", children: [_jsxs("div", { children: [_jsx("strong", { children: user.name }), " (", user.role, ")"] }), _jsxs("div", { children: ["Salt: ", _jsx("code", { children: user.salt })] }), _jsxs("div", { children: ["Hash: ", _jsx("code", { children: user.hash })] })] }, index))) })) : (_jsx("div", { className: "text-gray-600 italic", children: "No users found. Try \"Reset local data\"." })), pin && computed && (_jsxs("div", { className: "mt-3 p-2 bg-blue-50 rounded", children: [_jsx("div", { className: "text-xs", children: _jsxs("strong", { children: ["Computed hash for PIN \"", pin, "\" (using first user's salt):"] }) }), _jsx("code", { className: "text-xs", children: computed })] })), _jsxs("div", { className: "mt-3 text-xs text-gray-600 border-t pt-2", children: [_jsx("strong", { children: "Known seed PINs:" }), _jsx("br", {}), "\u2022 123456 (Admin User)", _jsx("br", {}), "\u2022 234567 (Nurse Joy)", _jsx("br", {}), "\u2022 111222 (Doctor Ada)", _jsx("br", {}), "\u2022 333444 (Pharmacist Chidi)", _jsx("br", {}), "\u2022 555666 (Volunteer Musa)"] })] }))] }) }));
}
