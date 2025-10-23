import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// Accessibility controls for font size, contrast, and motion
import { useState, useEffect } from 'react';
import { AdjustmentsHorizontalIcon, EyeIcon, SpeakerWaveIcon, DevicePhoneMobileIcon } from '@heroicons/react/24/outline';
const DEFAULT_SETTINGS = {
    fontSize: 'normal',
    contrast: 'normal',
    reducedMotion: false,
    audioEnabled: true,
    largeTargets: false
};
export function AccessibilityControls() {
    const [isOpen, setIsOpen] = useState(false);
    const [settings, setSettings] = useState(DEFAULT_SETTINGS);
    useEffect(() => {
        // Load settings from localStorage
        const saved = localStorage.getItem('mbhr-accessibility');
        if (saved) {
            try {
                setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(saved) });
            }
            catch (error) {
                console.warn('Failed to load accessibility settings:', error);
            }
        }
    }, []);
    useEffect(() => {
        // Apply settings to document
        applySettings(settings);
        // Save to localStorage
        localStorage.setItem('mbhr-accessibility', JSON.stringify(settings));
    }, [settings]);
    const applySettings = (settings) => {
        const root = document.documentElement;
        // Font size
        root.classList.remove('text-sm', 'text-base', 'text-lg', 'text-xl');
        switch (settings.fontSize) {
            case 'small':
                root.classList.add('text-sm');
                break;
            case 'large':
                root.classList.add('text-lg');
                break;
            case 'xlarge':
                root.classList.add('text-xl');
                break;
            default:
                root.classList.add('text-base');
        }
        // High contrast
        if (settings.contrast === 'high') {
            root.classList.add('high-contrast');
        }
        else {
            root.classList.remove('high-contrast');
        }
        // Reduced motion
        if (settings.reducedMotion) {
            root.classList.add('reduce-motion');
        }
        else {
            root.classList.remove('reduce-motion');
        }
        // Large touch targets
        if (settings.largeTargets) {
            root.classList.add('large-targets');
        }
        else {
            root.classList.remove('large-targets');
        }
    };
    const updateSetting = (key, value) => {
        setSettings(prev => ({ ...prev, [key]: value }));
    };
    return (_jsxs("div", { className: "relative", children: [_jsx("button", { onClick: () => setIsOpen(!isOpen), className: "p-2 rounded-lg hover:bg-gray-100 transition-colors touch-target", title: "Accessibility Settings", "aria-label": "Open accessibility settings", children: _jsx(AdjustmentsHorizontalIcon, { className: "h-5 w-5 text-gray-600" }) }), isOpen && (_jsx("div", { className: "absolute top-full right-0 mt-1 w-80 bg-white border border-gray-200 rounded-lg shadow-lg z-50", children: _jsxs("div", { className: "p-4", children: [_jsxs("h3", { className: "text-lg font-semibold text-gray-900 mb-4 flex items-center space-x-2", children: [_jsx(AdjustmentsHorizontalIcon, { className: "h-5 w-5" }), _jsx("span", { children: "Accessibility" })] }), _jsxs("div", { className: "space-y-4", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Text Size" }), _jsx("div", { className: "grid grid-cols-4 gap-2", children: ['small', 'normal', 'large', 'xlarge'].map((size) => (_jsx("button", { onClick: () => updateSetting('fontSize', size), className: `px-3 py-2 text-xs rounded-lg border transition-colors ${settings.fontSize === size
                                                    ? 'bg-primary text-white border-primary'
                                                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`, children: size === 'xlarge' ? 'XL' : size.charAt(0).toUpperCase() + size.slice(1) }, size))) })] }), _jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center space-x-2", children: [_jsx(EyeIcon, { className: "h-5 w-5 text-gray-600" }), _jsx("span", { className: "text-sm font-medium text-gray-700", children: "High Contrast" })] }), _jsx("button", { onClick: () => updateSetting('contrast', settings.contrast === 'high' ? 'normal' : 'high'), className: `relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${settings.contrast === 'high' ? 'bg-primary' : 'bg-gray-200'}`, children: _jsx("span", { className: `inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${settings.contrast === 'high' ? 'translate-x-6' : 'translate-x-1'}` }) })] }), _jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center space-x-2", children: [_jsx(DevicePhoneMobileIcon, { className: "h-5 w-5 text-gray-600" }), _jsx("span", { className: "text-sm font-medium text-gray-700", children: "Reduce Motion" })] }), _jsx("button", { onClick: () => updateSetting('reducedMotion', !settings.reducedMotion), className: `relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${settings.reducedMotion ? 'bg-primary' : 'bg-gray-200'}`, children: _jsx("span", { className: `inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${settings.reducedMotion ? 'translate-x-6' : 'translate-x-1'}` }) })] }), _jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center space-x-2", children: [_jsx(SpeakerWaveIcon, { className: "h-5 w-5 text-gray-600" }), _jsx("span", { className: "text-sm font-medium text-gray-700", children: "Audio Prompts" })] }), _jsx("button", { onClick: () => updateSetting('audioEnabled', !settings.audioEnabled), className: `relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${settings.audioEnabled ? 'bg-primary' : 'bg-gray-200'}`, children: _jsx("span", { className: `inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${settings.audioEnabled ? 'translate-x-6' : 'translate-x-1'}` }) })] }), _jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center space-x-2", children: [_jsx(DevicePhoneMobileIcon, { className: "h-5 w-5 text-gray-600" }), _jsx("span", { className: "text-sm font-medium text-gray-700", children: "Large Buttons" })] }), _jsx("button", { onClick: () => updateSetting('largeTargets', !settings.largeTargets), className: `relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${settings.largeTargets ? 'bg-primary' : 'bg-gray-200'}`, children: _jsx("span", { className: `inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${settings.largeTargets ? 'translate-x-6' : 'translate-x-1'}` }) })] })] }), _jsx("div", { className: "mt-4 pt-4 border-t border-gray-200", children: _jsx("p", { className: "text-xs text-gray-500", children: "Settings are saved locally and apply across all pages" }) })] }) }))] }));
}
