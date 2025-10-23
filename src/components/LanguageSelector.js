import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// Language selector with audio preview
import { useState } from 'react';
import { useT } from '@/hooks/useT';
import { getAvailableLocales } from '@/i18n/load';
import { LanguageIcon, SpeakerWaveIcon, CheckIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
export function LanguageSelector({ className = '', showAudioPreview = true }) {
    const { t, speak, changeLocale, locale, loading } = useT();
    const [isOpen, setIsOpen] = useState(false);
    const [playingAudio, setPlayingAudio] = useState(null);
    const availableLocales = getAvailableLocales();
    const currentLocale = availableLocales.find(l => l.code === locale);
    const handleLocaleChange = (newLocale) => {
        changeLocale(newLocale);
        setIsOpen(false);
    };
    const playAudioPreview = async (localeCode) => {
        setPlayingAudio(localeCode);
        try {
            // Play a sample phrase in the selected language
            await speak('auth.welcome');
        }
        catch (error) {
            console.warn('Audio preview failed:', error);
        }
        finally {
            setPlayingAudio(null);
        }
    };
    return (_jsxs("div", { className: `relative ${className}`, children: [_jsxs("button", { onClick: () => setIsOpen(!isOpen), className: "flex items-center space-x-2 px-3 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors", disabled: loading, children: [_jsx(LanguageIcon, { className: "h-5 w-5 text-gray-600" }), _jsx("span", { className: "text-sm font-medium text-gray-700", children: currentLocale?.nativeName || 'English' }), _jsx(ChevronDownIcon, { className: `h-4 w-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}` })] }), isOpen && (_jsxs("div", { className: "absolute top-full left-0 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-50", children: [_jsxs("div", { className: "p-2", children: [_jsx("div", { className: "text-xs font-medium text-gray-500 uppercase tracking-wider px-3 py-2", children: "Select Language" }), availableLocales.map((localeOption) => (_jsxs("div", { className: "flex items-center justify-between px-3 py-2 hover:bg-gray-50 rounded-lg cursor-pointer group", onClick: () => handleLocaleChange(localeOption.code), children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsxs("div", { className: "flex items-center space-x-2", children: [_jsx("span", { className: "text-sm font-medium text-gray-900", children: localeOption.nativeName }), localeOption.code !== 'en' && (_jsxs("span", { className: "text-xs text-gray-500", children: ["(", localeOption.name, ")"] }))] }), locale === localeOption.code && (_jsx(CheckIcon, { className: "h-4 w-4 text-primary" }))] }), showAudioPreview && (_jsx("button", { onClick: (e) => {
                                            e.stopPropagation();
                                            playAudioPreview(localeOption.code);
                                        }, className: "opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-gray-100 transition-all", disabled: playingAudio === localeOption.code, children: _jsx(SpeakerWaveIcon, { className: `h-4 w-4 text-gray-600 ${playingAudio === localeOption.code ? 'animate-pulse' : ''}` }) }))] }, localeOption.code)))] }), _jsx("div", { className: "border-t border-gray-100 p-3", children: _jsx("p", { className: "text-xs text-gray-500", children: "\uD83D\uDD0A Audio support available for key phrases" }) })] }))] }));
}
