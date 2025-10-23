import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect, memo } from 'react';
import { XMarkIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import { TouchButton } from './TouchButton';
export const PWAInstallPrompt = memo(() => {
    const [deferredPrompt, setDeferredPrompt] = useState(null);
    const [showPrompt, setShowPrompt] = useState(false);
    const [isInstalled, setIsInstalled] = useState(false);
    useEffect(() => {
        // Check if already installed
        if (window.matchMedia('(display-mode: standalone)').matches) {
            setIsInstalled(true);
            return;
        }
        // Check if dismissed before
        const dismissed = localStorage.getItem('pwa-install-dismissed');
        if (dismissed) {
            const dismissedDate = new Date(dismissed);
            const daysSinceDismissed = (Date.now() - dismissedDate.getTime()) / (1000 * 60 * 60 * 24);
            if (daysSinceDismissed < 7) {
                return; // Don't show again for 7 days
            }
        }
        const handler = (e) => {
            e.preventDefault();
            setDeferredPrompt(e);
            // Show prompt after 30 seconds of usage
            setTimeout(() => {
                setShowPrompt(true);
            }, 30000);
        };
        window.addEventListener('beforeinstallprompt', handler);
        return () => {
            window.removeEventListener('beforeinstallprompt', handler);
        };
    }, []);
    const handleInstall = async () => {
        if (!deferredPrompt)
            return;
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
            setShowPrompt(false);
            setIsInstalled(true);
        }
        setDeferredPrompt(null);
    };
    const handleDismiss = () => {
        setShowPrompt(false);
        localStorage.setItem('pwa-install-dismissed', new Date().toISOString());
    };
    if (isInstalled || !showPrompt || !deferredPrompt)
        return null;
    return (_jsx("div", { className: "fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 bg-white rounded-xl shadow-2xl border border-gray-200 z-50 animate-slide-up", children: _jsxs("div", { className: "p-4", children: [_jsxs("div", { className: "flex items-start justify-between mb-3", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("div", { className: "p-2 bg-primary/10 rounded-lg", children: _jsx(ArrowDownTrayIcon, { className: "h-6 w-6 text-primary" }) }), _jsxs("div", { children: [_jsx("h3", { className: "font-semibold text-gray-900", children: "Install mBHR" }), _jsx("p", { className: "text-sm text-gray-600", children: "Access offline & faster" })] })] }), _jsx("button", { onClick: handleDismiss, className: "p-1 rounded-full hover:bg-gray-100 active:bg-gray-200", "aria-label": "Dismiss", children: _jsx(XMarkIcon, { className: "h-5 w-5 text-gray-400" }) })] }), _jsxs("div", { className: "space-y-2 mb-4", children: [_jsxs("div", { className: "flex items-center gap-2 text-sm text-gray-600", children: [_jsx("svg", { className: "h-4 w-4 text-green-600", fill: "currentColor", viewBox: "0 0 20 20", children: _jsx("path", { fillRule: "evenodd", d: "M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z", clipRule: "evenodd" }) }), _jsx("span", { children: "Works offline" })] }), _jsxs("div", { className: "flex items-center gap-2 text-sm text-gray-600", children: [_jsx("svg", { className: "h-4 w-4 text-green-600", fill: "currentColor", viewBox: "0 0 20 20", children: _jsx("path", { fillRule: "evenodd", d: "M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z", clipRule: "evenodd" }) }), _jsx("span", { children: "Faster loading" })] }), _jsxs("div", { className: "flex items-center gap-2 text-sm text-gray-600", children: [_jsx("svg", { className: "h-4 w-4 text-green-600", fill: "currentColor", viewBox: "0 0 20 20", children: _jsx("path", { fillRule: "evenodd", d: "M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z", clipRule: "evenodd" }) }), _jsx("span", { children: "Home screen access" })] })] }), _jsxs("div", { className: "flex gap-2", children: [_jsx(TouchButton, { variant: "ghost", size: "md", onClick: handleDismiss, className: "flex-1", children: "Not now" }), _jsx(TouchButton, { variant: "primary", size: "md", onClick: handleInstall, className: "flex-1", icon: _jsx(ArrowDownTrayIcon, { className: "h-5 w-5" }), children: "Install" })] })] }) }));
});
PWAInstallPrompt.displayName = 'PWAInstallPrompt';
