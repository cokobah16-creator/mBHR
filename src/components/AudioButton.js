import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useAudioPrompts } from '@/hooks/useAudioPrompts';
import { SpeakerWaveIcon } from '@heroicons/react/24/outline';
export function AudioButton({ audioKey, fallbackText, children, className = '', onClick, disabled = false, type = 'button' }) {
    const { playPrompt, settings } = useAudioPrompts();
    const handleClick = async () => {
        // Play audio prompt if enabled
        if (settings.enabled) {
            await playPrompt(audioKey, fallbackText);
        }
        // Execute the actual click handler
        if (onClick) {
            onClick();
        }
    };
    return (_jsxs("button", { type: type, onClick: handleClick, disabled: disabled, className: `relative ${className}`, children: [children, settings.enabled && (_jsx(SpeakerWaveIcon, { className: "absolute top-1 right-1 h-3 w-3 text-white/70" }))] }));
}
