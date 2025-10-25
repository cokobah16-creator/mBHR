import { jsx as _jsx } from "react/jsx-runtime";
import { useRef } from 'react';
export function OTPInput({ length = 6, value, onChange, disabled = false, error = false }) {
    const inputRefs = useRef([]);
    const handleChange = (index, e) => {
        const val = e.target.value;
        if (!/^\d*$/.test(val))
            return;
        const newValue = value.split('');
        newValue[index] = val.slice(-1);
        const updatedValue = newValue.join('');
        onChange(updatedValue);
        if (val && index < length - 1) {
            inputRefs.current[index + 1]?.focus();
        }
    };
    const handleKeyDown = (index, e) => {
        if (e.key === 'Backspace' && !value[index] && index > 0) {
            inputRefs.current[index - 1]?.focus();
        }
        if (e.key === 'ArrowLeft' && index > 0) {
            inputRefs.current[index - 1]?.focus();
        }
        if (e.key === 'ArrowRight' && index < length - 1) {
            inputRefs.current[index + 1]?.focus();
        }
    };
    const handlePaste = (e) => {
        e.preventDefault();
        const pastedData = e.clipboardData.getData('text/plain').trim();
        if (!/^\d+$/.test(pastedData))
            return;
        const pastedValue = pastedData.slice(0, length);
        onChange(pastedValue);
        const nextEmptyIndex = pastedValue.length < length ? pastedValue.length : length - 1;
        inputRefs.current[nextEmptyIndex]?.focus();
    };
    return (_jsx("div", { className: "flex gap-2 justify-center", children: Array.from({ length }, (_, index) => (_jsx("input", { ref: el => inputRefs.current[index] = el, type: "text", inputMode: "numeric", maxLength: 1, value: value[index] || '', onChange: e => handleChange(index, e), onKeyDown: e => handleKeyDown(index, e), onPaste: handlePaste, disabled: disabled, className: `w-12 h-14 text-center text-2xl font-semibold border-2 rounded-lg
                     focus:outline-none focus:ring-2 focus:ring-blue-500
                     ${error ? 'border-red-500' : 'border-gray-300'}
                     ${disabled ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'}
                     transition-colors`, "aria-label": `OTP digit ${index + 1}` }, index))) }));
}
