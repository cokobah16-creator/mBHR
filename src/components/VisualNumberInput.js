import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { MinusIcon, PlusIcon } from '@heroicons/react/24/outline';
export function VisualNumberInput({ value, onChange, min = 0, max = 100, step = 1, label, unit, showDots = true, className = '' }) {
    const [inputValue, setInputValue] = useState(value.toString());
    const handleIncrement = () => {
        const newValue = Math.min(max, value + step);
        onChange(newValue);
        setInputValue(newValue.toString());
    };
    const handleDecrement = () => {
        const newValue = Math.max(min, value - step);
        onChange(newValue);
        setInputValue(newValue.toString());
    };
    const handleInputChange = (e) => {
        const inputVal = e.target.value;
        setInputValue(inputVal);
        const numVal = parseFloat(inputVal);
        if (!isNaN(numVal) && numVal >= min && numVal <= max) {
            onChange(numVal);
        }
    };
    const renderDots = () => {
        if (!showDots || value > 20)
            return null;
        return (_jsx("div", { className: "flex flex-wrap gap-1 justify-center mt-3", children: Array.from({ length: Math.floor(value) }, (_, i) => (_jsx("div", { className: "w-3 h-3 bg-primary rounded-full" }, i))) }));
    };
    return (_jsxs("div", { className: `space-y-4 ${className}`, children: [_jsx("label", { className: "block text-lg font-medium text-gray-700 text-center", children: label }), _jsxs("div", { className: "flex items-center justify-center space-x-4", children: [_jsx("button", { type: "button", onClick: handleDecrement, disabled: value <= min, className: "w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center hover:bg-red-200 disabled:opacity-50 disabled:cursor-not-allowed touch-target-large", children: _jsx(MinusIcon, { className: "h-6 w-6" }) }), _jsxs("div", { className: "text-center", children: [_jsx("input", { type: "number", value: inputValue, onChange: handleInputChange, min: min, max: max, step: step, className: "w-24 text-3xl font-bold text-center border-2 border-gray-300 rounded-lg py-2 focus:border-primary focus:ring-2 focus:ring-primary/20" }), unit && (_jsx("div", { className: "text-sm text-gray-600 mt-1", children: unit }))] }), _jsx("button", { type: "button", onClick: handleIncrement, disabled: value >= max, className: "w-12 h-12 bg-green-100 text-green-600 rounded-full flex items-center justify-center hover:bg-green-200 disabled:opacity-50 disabled:cursor-not-allowed touch-target-large", children: _jsx(PlusIcon, { className: "h-6 w-6" }) })] }), renderDots()] }));
}
